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
  queriesStarted: 0,
  queriesFailed: 0,
  queriesQueued: 0,
  queryDurationMs: 0,
};

let maxConnections = 0;

const roundDuration = (durationMs: number): number => Math.round(durationMs * 100) / 100;

/*
 * Bun's SQL exposes no pool statistics: the whole prototype chain carries only
 * `options`, and `reserve()` hands back a connection that already has queries in
 * flight instead of waiting for a free one. Counting issue and settlement at the
 * single seam every drizzle query passes through — `client.unsafe` — is the only
 * way to see how much demand the process is putting on the pool. The returned
 * query is lazy and its result mode is chosen by a later `.values()` call, so the
 * proxy must forward untouched and hook `then` rather than awaiting anything.
 */
const instrumentQuery = (query: object): object => {
  counters.queriesStarted += 1;
  counters.inFlight += 1;
  if (maxConnections > 0 && counters.inFlight > maxConnections) {
    counters.queriesQueued += 1;
  }

  const startedAt = performance.now();
  let settled = false;
  const settle = (failed: boolean): void => {
    if (settled) {
      return;
    }
    settled = true;
    counters.inFlight -= 1;
    counters.queryDurationMs += performance.now() - startedAt;
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

  return new Proxy(query, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property === "then") {
        return (
          onFulfilled?: (result: unknown) => unknown,
          onRejected?: (error: unknown) => unknown,
        ): unknown =>
          (value as AnyFunction).call(
            target,
            (result: unknown) => settleFulfilled(onFulfilled, result),
            (error: unknown) => settleRejected(onRejected, error),
          );
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

const instrumentClient = (client: InstrumentableClient): InstrumentableClient => {
  const originalUnsafe = client.unsafe;
  client.unsafe = (query: string, params?: unknown[]): object =>
    instrumentQuery(originalUnsafe.call(client, query, params));

  const instrumentArgument = (argument: unknown): unknown => {
    if (typeof argument !== "function") {
      return argument;
    }
    return (inner: InstrumentableClient): unknown =>
      (argument as (transactionClient: InstrumentableClient) => unknown)(instrumentClient(inner));
  };

  for (const method of TRANSACTION_METHODS) {
    const original = client[method];
    if (typeof original !== "function") {
      continue;
    }
    client[method] = (...args: unknown[]): unknown =>
      (original as AnyFunction).apply(client, args.map((argument) => instrumentArgument(argument)));
  }

  return client;
};

const instrumentDatabasePool = (
  client: InstrumentableClient,
  poolMaxConnections: number,
): void => {
  maxConnections = poolMaxConnections;
  instrumentClient(client);
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

  return () => ({
    inFlight: counters.inFlight,
    queryCount: counters.queriesStarted - startedQueries,
    queryDurationMs: roundDuration(counters.queryDurationMs - startedDurationMs),
    queuedQueryCount: counters.queriesQueued - startedQueued,
    failedQueryCount: counters.queriesFailed - startedFailures,
  });
};

const resetDatabasePoolTelemetry = (): void => {
  counters.inFlight = 0;
  counters.queriesStarted = 0;
  counters.queriesFailed = 0;
  counters.queriesQueued = 0;
  counters.queryDurationMs = 0;
  maxConnections = 0;
};

export { instrumentDatabasePool, openDatabasePoolWindow, resetDatabasePoolTelemetry };
export type { DatabasePoolWindow, DatabasePoolWindowSample };
