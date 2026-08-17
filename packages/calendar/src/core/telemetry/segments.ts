import { widelog } from "widelogger";
import { beginInFlight, endInFlight } from "./in-flight";
import type { InFlightKind } from "./in-flight";

/**
 * Every wait and work key below is a disjoint wall-clock slice of the per-source
 * `duration_ms` timer. Recording one always credits `accounted_ms` too, so the
 * residual is a single subtraction at query time:
 * unaccounted_ms = duration_ms - accounted_ms.
 *
 * These are wall clock, not CPU: with five sources sharing one event loop, time a
 * peer stole is charged to whichever segment happened to be awaiting. That makes
 * head-of-line blocking visible, and it is why no segment may ever be read as
 * "this much work was done".
 */
type IngestSegmentKey =
  | "wait.source_lock_ms"
  | "wait.token_refresh_ms"
  | "wait.rate_limiter_ms"
  | "wait.provider_retry_ms"
  | "wait.db_pool_ms"
  | "wait.advisory_lock_ms"
  | "work.provider_http_ms"
  | "work.transform_ms"
  | "work.db_read_ms"
  | "work.db_write_ms"
  | "work.db_commit_ms"
  | "work.diff_ms";

const ACCOUNTED_SEGMENT_KEY = "accounted_ms";
const REDIS_COMMAND_MAX_KEY = "redis.command_ms_max";
const MILLISECOND_PRECISION = 100;

const roundMs = (durationMs: number): number =>
  Math.round(durationMs * MILLISECOND_PRECISION) / MILLISECOND_PRECISION;

const recordSegment = (key: IngestSegmentKey, durationMs: number): void => {
  const rounded = roundMs(durationMs);
  widelog.count(key, rounded);
  widelog.count(ACCOUNTED_SEGMENT_KEY, rounded);
};

const SEGMENT_IN_FLIGHT_KINDS = {
  "wait.advisory_lock_ms": "lock",
  "wait.db_pool_ms": "db_pool",
  "wait.rate_limiter_ms": "rate_limit",
  "wait.source_lock_ms": "lock",
  "work.db_commit_ms": "db_query",
  "work.db_read_ms": "db_query",
  "work.db_write_ms": "db_query",
} as const;

const resolveInFlightKind = (key: IngestSegmentKey): InFlightKind =>
  SEGMENT_IN_FLIGHT_KINDS[key as keyof typeof SEGMENT_IN_FLIGHT_KINDS] ?? "segment";

const measureSegment = async <TResult>(
  key: IngestSegmentKey,
  operation: () => Promise<TResult>,
): Promise<TResult> => {
  const startedAt = performance.now();
  const callId = beginInFlight(resolveInFlightKind(key), key);
  try {
    return await operation();
  } finally {
    endInFlight(callId);
    recordSegment(key, performance.now() - startedAt);
  }
};

const measureSyncSegment = <TResult>(
  key: IngestSegmentKey,
  operation: () => TResult,
): TResult => {
  const startedAt = performance.now();
  try {
    return operation();
  } finally {
    recordSegment(key, performance.now() - startedAt);
  }
};

const measureProviderRequest = async <TResult>(
  operation: () => Promise<TResult>,
): Promise<TResult> => {
  const startedAt = performance.now();
  try {
    return await operation();
  } finally {
    const elapsedMs = performance.now() - startedAt;
    recordSegment("work.provider_http_ms", elapsedMs);
    widelog.count("provider.request_count", 1);
    widelog.max("provider.slowest_request_ms", roundMs(elapsedMs));
  }
};

/*
 * An overlay, never a segment: these round trips already sit inside
 * wait.source_lock_ms and wait.rate_limiter_ms, so crediting accounted_ms here
 * would double count. It exists only to split "the lock was held" from
 * "Redis was slow".
 */
const recordRedisCommandDuration = (durationMs: number): void => {
  widelog.max(REDIS_COMMAND_MAX_KEY, roundMs(durationMs));
};

const measureRedisCommand = async <TResult>(
  operation: () => Promise<TResult>,
  command = "redis",
): Promise<TResult> => {
  const startedAt = performance.now();
  const callId = beginInFlight("redis", command);
  try {
    return await operation();
  } finally {
    endInFlight(callId);
    recordRedisCommandDuration(performance.now() - startedAt);
  }
};

export {
  ACCOUNTED_SEGMENT_KEY,
  measureProviderRequest,
  measureRedisCommand,
  measureSegment,
  measureSyncSegment,
  recordRedisCommandDuration,
  recordSegment,
  REDIS_COMMAND_MAX_KEY,
};
export type { IngestSegmentKey };
