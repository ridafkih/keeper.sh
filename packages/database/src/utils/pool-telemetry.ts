import { AsyncLocalStorage } from "node:async_hooks";

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
  pooledQueriesInFlight: 0,
};

/*
 * A window belongs to the unit of work that opened it -- one destination sync
 * attempt -- and a process runs many of those at once. Counting queries on
 * process-wide totals would hand every concurrent attempt the sum of all of
 * them: query counts multiplied by the concurrency factor and a query duration
 * larger than the attempt that reports it. A query is therefore charged to the
 * window open in the async context that issued it, so `queryCount`,
 * `queryDurationMs`, `queuedQueryCount` and `failedQueryCount` all describe the
 * same population, the queries this window's own work issued.
 *
 * `inFlight` stays process-wide on purpose: it is a pool gauge, and how much of
 * the pool is busy right now is a property of the process, not of one attempt.
 *
 * A window is bounded by the body it is opened around rather than left set on
 * the context it was opened from. Scoping it to a callback is what keeps a
 * caller's later queries off the window a function it called had opened, and it
 * keeps the module off `AsyncLocalStorage.enterWith`, which segfaults Bun when
 * it is reached from a top-level-await chain.
 */
interface WindowScope {
  failedQueryCount: number;
  queryCount: number;
  queryDurationMs: number;
  queuedQueryCount: number;
}

const windowScopes = new AsyncLocalStorage<WindowScope | null>();

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
interface PendingAcquisition {
  awaited: Promise<unknown> | null;
  released: boolean;
}

const pendingAcquisitions = new Set<PendingAcquisition>();

/*
 * A transaction that dies before the pool ever grants it a connection never runs
 * its callback, so its demand has to be dropped from the outcome or it inflates
 * occupancy for the rest of the process. Attaching a rejection handler to that
 * outcome would mark the transaction's rejection handled and silence the
 * process-level unhandled-rejection signal, and re-throwing from the handler
 * would instead invent a rejection nobody can catch, so the outcome is read
 * without being consumed: `Bun.peek.status` reports a promise's state without
 * attaching anything to it. Settled demand is swept the next time occupancy is
 * computed, which is before any verdict that would have used it.
 */
const releaseSettledAcquisitions = (): void => {
  if (pendingAcquisitions.size === 0) {
    return;
  }
  for (const acquisition of pendingAcquisitions) {
    if (!acquisition.awaited || Bun.peek.status(acquisition.awaited) === "pending") {
      continue;
    }
    acquisition.released = true;
    pendingAcquisitions.delete(acquisition);
  }
};

const occupiedConnections = (): number => {
  releaseSettledAcquisitions();
  return counters.heldConnections + counters.pooledQueriesInFlight + pendingAcquisitions.size;
};

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
 *
 * A lazy query only reaches the wire when something subscribes to it, and only a
 * subscription can ever settle it, so issue is counted on the first subscription
 * rather than on construction. Counting at construction would pair an increment
 * that always happens with a decrement that happens only if the query is
 * awaited: a query built and dropped would hold `inFlight` and
 * `pooledQueriesInFlight` for the life of the process, and enough of them would
 * park `waitsForConnection` at true and report every later query on an idle pool
 * as queued. Both counters now move on the same guaranteed-paired event, the
 * transition of one query through issued and then settled, which each happen at
 * most once however many times `then`, `catch` and `finally` are called.
 */
const instrumentQuery = (
  query: object,
  transactional: boolean,
  transactionState: TransactionState | undefined,
): object => {
  const scope = windowScopes.getStore() ?? null;

  let state: "unissued" | "issued" | "settled" = "unissued";
  let startedAt = 0;

  const issue = (): void => {
    if (state !== "unissued") {
      return;
    }
    state = "issued";

    let queued = false;
    if (transactional) {
      /*
       * A statement inside a transaction runs on a connection the transaction
       * already owns, so it never queues; the wait its transaction served before
       * the pool let it start is charged to the first statement that follows.
       */
      if (transactionState?.pendingQueued) {
        transactionState.pendingQueued = false;
        queued = true;
      }
    } else {
      queued = waitsForConnection();
      counters.pooledQueriesInFlight += 1;
    }

    counters.inFlight += 1;
    if (scope) {
      scope.queryCount += 1;
      if (queued) {
        scope.queuedQueryCount += 1;
      }
    }

    startedAt = performance.now();
  };

  const settle = (failed: boolean): void => {
    if (state !== "issued") {
      return;
    }
    state = "settled";
    const durationMs = performance.now() - startedAt;
    counters.inFlight -= 1;
    if (!transactional) {
      counters.pooledQueriesInFlight -= 1;
    }
    if (scope) {
      scope.queryDurationMs += durationMs;
      if (failed) {
        scope.failedQueryCount += 1;
      }
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
  ): Promise<unknown> => {
    issue();
    return (Reflect.get(target, "then") as AnyFunction).call(
      target,
      (result: unknown) => settleFulfilled(onFulfilled, result),
      (error: unknown) => settleRejected(onRejected, error),
    ) as Promise<unknown>;
  };

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
      /*
       * A transaction that has to wait for a connection is resumed by whoever
       * released one, so the pool hands its callback that releaser's async
       * context rather than the context the transaction was opened from. The
       * scope open at the call is therefore captured here and re-established
       * around the callback, or every statement of a transaction that queued
       * would be charged to a stranger's window, or to no window at all.
       */
      const issuingScope = windowScopes.getStore() ?? null;

      if (!acquiresConnection) {
        const instrumentNested = (argument: unknown): unknown => {
          if (typeof argument !== "function") {
            return argument;
          }
          const callback = argument as (transactionClient: InstrumentableClient) => unknown;
          return (inner: InstrumentableClient): unknown =>
            windowScopes.run(issuingScope, () => callback(instrumentClient(inner, true)));
        };
        return (original as AnyFunction).apply(
          client,
          args.map((argument) => instrumentNested(argument)),
        );
      }

      const queued = waitsForConnection();
      const acquisition: PendingAcquisition = { awaited: null, released: false };
      pendingAcquisitions.add(acquisition);
      const resolveAcquisition = (): void => {
        if (acquisition.released) {
          return;
        }
        acquisition.released = true;
        pendingAcquisitions.delete(acquisition);
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
            return await windowScopes.run(
              issuingScope,
              () => callback(instrumentClient(inner, true)),
            );
          } finally {
            counters.heldConnections -= 1;
          }
        };
      };

      /*
       * The callback is the normal end of an acquisition; the outcome is only a
       * fallback for the transaction that dies before the pool grants it one,
       * and it is read by sweeping rather than by subscribing so that the
       * caller's promise keeps exactly the rejection semantics it had
       * uninstrumented. An outcome that is not a native promise cannot be swept
       * -- reading it at all means calling its `then`, which would mark its
       * rejection handled -- so its demand is dropped immediately rather than
       * bought at the price of changing what the process observes.
       */
      try {
        const returned = (original as AnyFunction).apply(
          client,
          args.map((argument) => instrumentArgument(argument)),
        );
        if (returned instanceof Promise) {
          acquisition.awaited = returned;
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

const withDatabasePoolWindow = <TResult>(
  body: (readWindow: DatabasePoolWindow) => TResult,
): TResult => {
  const scope: WindowScope = {
    failedQueryCount: 0,
    queryCount: 0,
    queryDurationMs: 0,
    queuedQueryCount: 0,
  };
  const readWindow: DatabasePoolWindow = () => ({
    inFlight: counters.inFlight,
    queryCount: scope.queryCount,
    queryDurationMs: roundDuration(scope.queryDurationMs),
    queuedQueryCount: scope.queuedQueryCount,
    failedQueryCount: scope.failedQueryCount,
  });

  return windowScopes.run(scope, () => body(readWindow));
};

const resetDatabasePoolTelemetry = (): void => {
  for (const acquisition of pendingAcquisitions) {
    acquisition.released = true;
  }
  pendingAcquisitions.clear();
  counters.inFlight = 0;
  counters.heldConnections = 0;
  counters.pooledQueriesInFlight = 0;
  maxConnections = 0;
};

export { instrumentDatabasePool, resetDatabasePoolTelemetry, withDatabasePoolWindow };
export type { DatabasePoolWindow, DatabasePoolWindowSample };
