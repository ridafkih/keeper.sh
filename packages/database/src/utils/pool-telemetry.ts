interface DatabasePoolWindowSample {
  inFlight: number;
  queryCount: number;
  queryDurationMs: number;
  queuedQueryCount: number;
  failedQueryCount: number;
}

type DatabasePoolWindow = () => DatabasePoolWindowSample;

type AnyFunction = (...args: unknown[]) => unknown;

interface InstrumentableClient extends Record<string, unknown> {
  unsafe: (query: string, params?: unknown[]) => object;
}

const counters = {
  inFlight: 0,
  heldConnections: 0,
  pendingAcquisitions: 0,
  pooledQueriesInFlight: 0,
  queriesStarted: 0,
  queriesFailed: 0,
  queriesQueued: 0,
  queryDurationMs: 0,
};

interface QueryRecord {
  settled: boolean;
  failed: boolean;
  durationMs: number;
}

const inFlightQueries = new Set<QueryRecord>();

let maxConnections = 0;

const roundDuration = (durationMs: number): number => Math.round(durationMs * 100) / 100;

/*
 * A Bun pool connection is occupied for the whole lifetime of a transaction,
 * idle gaps between statements included, not merely while a statement is on the
 * wire. Query concurrency therefore says nothing about pool availability: two
 * open transactions can exhaust a `max: 2` pool while a single statement is in
 * flight. Occupancy is held transactions plus the queries issued outside any
 * transaction, and that is what a newly issued unit of work has to get past.
 *
 * Demand that has been requested but not yet granted counts too. A transaction
 * only raises `heldConnections` once the pool hands it a connection and its
 * callback runs, which is at best a tick after `begin` was called, so a burst
 * issued in a single tick would otherwise all read the occupancy that preceded
 * the burst and every member of it would look unqueued no matter how long the
 * pool actually made it wait.
 */
const occupiedConnections = (): number =>
  counters.heldConnections + counters.pooledQueriesInFlight + counters.pendingAcquisitions;

const waitsForConnection = (): boolean =>
  maxConnections > 0 && occupiedConnections() >= maxConnections;

interface TransactionState {
  pendingQueued: boolean;
}

const transactionStates = new WeakMap<object, TransactionState>();

/*
 * Bun's SQL exposes no pool statistics: the whole prototype chain carries only
 * `options`, and `reserve()` hands back a connection that already has queries in
 * flight instead of waiting for a free one. Counting issue and settlement at the
 * single seam every drizzle query passes through — `client.unsafe` — is the only
 * way to see how much demand the process is putting on the pool. The returned
 * query is lazy and its result mode is chosen by a later `.values()` call, so the
 * proxy must forward untouched and hook `then` rather than awaiting anything.
 *
 * `catch` and `finally` are own methods on Bun's SQLQuery that reach the raw
 * `then`, so they are routed back through the hooked one; leaving them to the
 * generic forwarder would let a query settle without ever releasing in-flight.
 */
const instrumentQuery = (
  query: object,
  transactional: boolean,
  transactionState: TransactionState | undefined,
): object => {
  counters.queriesStarted += 1;
  counters.inFlight += 1;
  if (transactional) {
    /*
     * A statement inside a transaction runs on a connection the transaction
     * already owns, so it never queues; the wait its transaction served before
     * the pool let it start is charged to the first statement that follows.
     */
    if (transactionState?.pendingQueued) {
      transactionState.pendingQueued = false;
      counters.queriesQueued += 1;
    }
  } else {
    if (waitsForConnection()) {
      counters.queriesQueued += 1;
    }
    counters.pooledQueriesInFlight += 1;
  }

  const startedAt = performance.now();
  const record: QueryRecord = { settled: false, failed: false, durationMs: 0 };
  inFlightQueries.add(record);
  const settle = (failed: boolean): void => {
    if (record.settled) {
      return;
    }
    record.settled = true;
    record.failed = failed;
    record.durationMs = performance.now() - startedAt;
    inFlightQueries.delete(record);
    counters.inFlight -= 1;
    if (!transactional) {
      counters.pooledQueriesInFlight -= 1;
    }
    counters.queryDurationMs += record.durationMs;
    if (failed) {
      counters.queriesFailed += 1;
    }
  };

  const settleFulfilled = (
    onFulfilled: ((result: unknown) => unknown) | undefined,
    result: unknown,
  ): unknown => {
    settle(false);
    if (onFulfilled) {
      return onFulfilled(result);
    }
    return result;
  };

  const settleRejected = (
    onRejected: ((error: unknown) => unknown) | undefined,
    error: unknown,
  ): unknown => {
    settle(true);
    if (onRejected) {
      return onRejected(error);
    }
    throw error;
  };

  const settledThen = (
    target: object,
    onFulfilled?: (result: unknown) => unknown,
    onRejected?: (error: unknown) => unknown,
  ): Promise<unknown> =>
    (Reflect.get(target, "then") as AnyFunction).call(
      target,
      (result: unknown) => settleFulfilled(onFulfilled, result),
      (error: unknown) => settleRejected(onRejected, error),
    ) as Promise<unknown>;

  return new Proxy(query, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property === "then") {
        return (
          onFulfilled?: (result: unknown) => unknown,
          onRejected?: (error: unknown) => unknown,
        ): unknown => settledThen(target, onFulfilled, onRejected);
      }
      if (property === "catch") {
        return (onRejected?: (error: unknown) => unknown): unknown =>
          settledThen(target).catch(onRejected);
      }
      if (property === "finally") {
        return (onFinally?: () => unknown): unknown => settledThen(target).finally(onFinally);
      }
      if (typeof value === "function") {
        return (...args: unknown[]): unknown => {
          const returned = (value as AnyFunction).apply(target, args);
          if (returned === target) {
            return receiver;
          }
          return returned;
        };
      }
      return value;
    },
  });
};

const TRANSACTION_METHODS = ["begin", "savepoint", "transaction"] as const;

/*
 * Bun hands `begin` a fresh transaction client but hands `savepoint` the very
 * client it was called on, so a savepoint would otherwise stack a second set of
 * wrappers on an already-wrapped client and count every later query once per
 * layer — 2^depth inflation of query counts, durations and queued queries.
 * Instrumentation mutates the client in place, so it must run at most once per
 * client object.
 */
const instrumentedClients = new WeakSet<object>();

const instrumentClient = (
  client: InstrumentableClient,
  transactional: boolean,
): InstrumentableClient => {
  if (instrumentedClients.has(client)) {
    return client;
  }
  instrumentedClients.add(client);

  const originalUnsafe = client.unsafe;
  client.unsafe = (query: string, params?: unknown[]): object =>
    instrumentQuery(
      originalUnsafe.call(client, query, params),
      transactional,
      transactionStates.get(client),
    );

  for (const method of TRANSACTION_METHODS) {
    const original = client[method];
    if (typeof original !== "function") {
      continue;
    }
    /*
     * `begin` on a pool client takes a connection out of the pool for as long as
     * its callback runs. `savepoint`, and any transaction method reached from a
     * client already inside a transaction, run on the connection that
     * transaction holds and must not be counted as a second occupant.
     */
    const acquiresConnection = !transactional && method !== "savepoint";
    client[method] = (...args: unknown[]): unknown => {
      if (!acquiresConnection) {
        const instrumentNested = (argument: unknown): unknown => {
          if (typeof argument !== "function") {
            return argument;
          }
          const callback = argument as (transactionClient: InstrumentableClient) => unknown;
          return (inner: InstrumentableClient): unknown => callback(instrumentClient(inner, true));
        };
        return (original as AnyFunction).apply(
          client,
          args.map((argument) => instrumentNested(argument)),
        );
      }

      const queued = waitsForConnection();
      counters.pendingAcquisitions += 1;
      let acquisitionResolved = false;
      const resolveAcquisition = (): void => {
        if (acquisitionResolved) {
          return;
        }
        acquisitionResolved = true;
        counters.pendingAcquisitions -= 1;
      };

      const instrumentArgument = (argument: unknown): unknown => {
        if (typeof argument !== "function") {
          return argument;
        }
        const callback = argument as (transactionClient: InstrumentableClient) => unknown;
        return async (inner: InstrumentableClient): Promise<unknown> => {
          resolveAcquisition();
          counters.heldConnections += 1;
          transactionStates.set(inner, { pendingQueued: queued });
          try {
            return await callback(instrumentClient(inner, true));
          } finally {
            counters.heldConnections -= 1;
          }
        };
      };

      /*
       * The callback is the normal end of an acquisition, but a transaction can
       * fail before the pool ever grants it a connection, in which case the
       * callback never runs and the demand has to be released from the outcome
       * instead or it would inflate occupancy for the rest of the process.
       */
      try {
        const returned = (original as AnyFunction).apply(
          client,
          args.map((argument) => instrumentArgument(argument)),
        );
        if (typeof (returned as PromiseLike<unknown> | undefined)?.then === "function") {
          (returned as PromiseLike<unknown>).then(resolveAcquisition, resolveAcquisition);
        } else {
          resolveAcquisition();
        }
        return returned;
      } catch (error) {
        resolveAcquisition();
        throw error;
      }
    };
  }

  return client;
};

const instrumentDatabasePool = (
  client: InstrumentableClient,
  poolMaxConnections: number,
): void => {
  maxConnections = poolMaxConnections;
  instrumentClient(client, false);
};

/*
 * The counters are process-wide, so a window opened around one sync attempt also
 * sees every query another concurrent attempt issued. That is the point: pool
 * pressure is a property of the process, not of a single attempt.
 */
const openDatabasePoolWindow = (): DatabasePoolWindow => {
  const startedQueries = counters.queriesStarted;
  const startedFailures = counters.queriesFailed;
  const startedQueued = counters.queriesQueued;
  const startedDurationMs = counters.queryDurationMs;
  /*
   * A query is counted when it is issued but its duration and its failure land
   * on the process counters when it settles, so a query already in flight when
   * the window opened would otherwise charge this window for work it never
   * counted -- a window reporting one failure and zero queries. Those queries
   * are known at open time, so their contributions are subtracted back out and
   * every field describes the same population: the queries this window counted.
   */
  const inheritedQueries = [...inFlightQueries];

  return () => {
    let inheritedDurationMs = 0;
    let inheritedFailures = 0;
    for (const record of inheritedQueries) {
      if (!record.settled) {
        continue;
      }
      inheritedDurationMs += record.durationMs;
      if (record.failed) {
        inheritedFailures += 1;
      }
    }

    return {
      inFlight: counters.inFlight,
      queryCount: counters.queriesStarted - startedQueries,
      queryDurationMs: roundDuration(
        counters.queryDurationMs - startedDurationMs - inheritedDurationMs,
      ),
      queuedQueryCount: counters.queriesQueued - startedQueued,
      failedQueryCount: counters.queriesFailed - startedFailures - inheritedFailures,
    };
  };
};

const resetDatabasePoolTelemetry = (): void => {
  inFlightQueries.clear();
  counters.inFlight = 0;
  counters.heldConnections = 0;
  counters.pendingAcquisitions = 0;
  counters.pooledQueriesInFlight = 0;
  counters.queriesStarted = 0;
  counters.queriesFailed = 0;
  counters.queriesQueued = 0;
  counters.queryDurationMs = 0;
  maxConnections = 0;
};

export { instrumentDatabasePool, openDatabasePoolWindow, resetDatabasePoolTelemetry };
export type { DatabasePoolWindow, DatabasePoolWindowSample };
