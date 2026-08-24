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

interface WindowScope {
  failedQueryCount: number;
  queryCount: number;
  queryDurationMs: number;
  queuedQueryCount: number;
}

// Always scoped with `run`: `enterWith` segfaults Bun 1.3.14 under top-level await.
const windowScopes = new AsyncLocalStorage<WindowScope | null>();

let maxConnections = 0;

const roundDuration = (durationMs: number): number => Math.round(durationMs * 100) / 100;

/*
 * Bun holds a connection for a transaction's whole lifetime, idle gaps included, and
 * raises `heldConnections` only once the callback runs — a tick or more after `begin`.
 * Requested-but-ungranted demand therefore has to count, or a burst issued in one tick
 * reads the occupancy that preceded it and every member looks unqueued.
 */
interface PendingAcquisition {
  awaited: Promise<unknown> | null;
  released: boolean;
}

const pendingAcquisitions = new Set<PendingAcquisition>();

// Swept via `Bun.peek.status`: subscribing would mark the caller's rejection handled.
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
 * Bun's SQL exposes no pool statistics, so `client.unsafe` is the only seam every
 * drizzle query passes through. Its SQLQuery is lazy: a query is counted when a
 * subscription issues it, never on construction, so that each increment is paired with
 * a decrement — a built-and-dropped query would otherwise hold `inFlight` forever and
 * park `waitsForConnection` at true. `catch` and `finally` are own methods reaching the
 * raw `then`, so they must route through the hooked one or a query settles unreleased.
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
       * A statement never queues on its own transaction's connection; it inherits the
       * wait the transaction served before the pool let it start.
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
 * Bun hands `savepoint` the very client it was called on, so without this dedup a
 * nested transaction stacks a second set of wrappers and inflates every count by
 * 2^depth. Instrumentation mutates in place and must run once per client object.
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
    const acquiresConnection = !transactional && method !== "savepoint";
    client[method] = (...args: unknown[]): unknown => {
      /*
       * A queued transaction's callback runs in the async context of whoever released the
       * connection, so the issuing scope is captured here and restored around it.
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
       * A non-native thenable cannot be read without consuming its rejection, so its
       * demand is dropped rather than swept.
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
