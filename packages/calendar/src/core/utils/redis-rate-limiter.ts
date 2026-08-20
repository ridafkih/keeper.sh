import {
  GOOGLE_PUSH_REQUESTS_PER_MINUTE,
  GOOGLE_REQUESTS_PER_MINUTE,
} from "@keeper.sh/constants";
import { widelog } from "widelogger";
import { measureRedisCommand, recordSegment } from "../telemetry/segments";
import { createLeasedSemaphore } from "./leased-semaphore";
import { flagPacingParkAbortReason } from "./pacing-park";
import type { RedisLeaseClient, SemaphoreLease } from "./leased-semaphore";

const MS_PER_MINUTE = 60_000;
const RETRY_POLL_MS = 100;
const ACQUIRE_RESULT_LENGTH = 2;
const QUEUE_DEPTH_INDEX = 2;
/* Beyond SOURCE_TIMEOUT_MS, so a waiter killed by the ingest deadline expires rather than wedging the head. */
const QUEUE_ENTRY_TTL_MS = 180_000;

interface RedisRateLimiter {
  acquire(count: number, signal?: AbortSignal): Promise<void>;
}

interface RedisRateLimiterConfig {
  requestsPerMinute: number;
}

interface RedisScriptClient {
  eval(script: string, numberOfKeys: number, ...arguments_: string[]): Promise<unknown>;
}

/**
 * KEYS[1] = sorted set key
 * ARGV = [window start ms, now ms, slots to acquire, max requests per minute]
 * ARGV[5..6] = [waiter token, queue entry ttl ms] — sent only once an acquire has parked.
 * Returns [waitTime, occupancy] and, on a tokened call, the queue depth; waitTime 0 means acquired.
 */
const ACQUIRE_SCRIPT = `
  redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
  local current = redis.call('ZCARD', KEYS[1])
  local count = tonumber(ARGV[3])
  local limit = tonumber(ARGV[4])
  local now = tonumber(ARGV[2])
  local token = ARGV[5]

  if token == nil or token == '' then
    if current + count <= limit then
      for i = 1, count do
        redis.call('ZADD', KEYS[1], now, now .. ':' .. i .. ':' .. math.random(1000000))
      end
      redis.call('PEXPIRE', KEYS[1], 60000)
      return {0, current}
    end

    local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
    if #oldest >= 2 then
      local oldestScore = tonumber(oldest[2])
      return {oldestScore + 60000 - now, current}
    end

    return {1000, current}
  end

  local queueKey = KEYS[1] .. ':queue'
  local queueTtl = tonumber(ARGV[6])
  redis.call('ZREMRANGEBYSCORE', queueKey, '-inf', now - queueTtl)
  local head = redis.call('ZRANGE', queueKey, 0, 0)

  if (head[1] == nil or head[1] == token) and current + count <= limit then
    for i = 1, count do
      redis.call('ZADD', KEYS[1], now, now .. ':' .. i .. ':' .. math.random(1000000))
    end
    redis.call('PEXPIRE', KEYS[1], 60000)
    redis.call('ZREM', queueKey, token)
    return {0, current, redis.call('ZCARD', queueKey)}
  end

  redis.call('ZADD', queueKey, 'NX', now, token)
  redis.call('PEXPIRE', queueKey, queueTtl)
  local depth = redis.call('ZCARD', queueKey)

  local queuedOldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  if #queuedOldest >= 2 then
    return {tonumber(queuedOldest[2]) + 60000 - now, current, depth}
  end

  return {1000, current, depth}
`;

/* KEYS[1] = sorted set key, ARGV[1] = waiter token. */
const LEAVE_QUEUE_SCRIPT = `
  redis.call('ZREM', KEYS[1] .. ':queue', ARGV[1])
  return 1
`;

interface AcquireDecision {
  occupancy: number;
  queueDepth?: number;
  waitTimeMs: number;
}

const parseAcquireDecision = (raw: unknown): AcquireDecision => {
  if (!Array.isArray(raw) || raw.length < ACQUIRE_RESULT_LENGTH) {
    throw new Error("Rate limiter acquire script returned an unexpected result shape");
  }
  const decision: AcquireDecision = { occupancy: Number(raw[1]), waitTimeMs: Number(raw[0]) };
  if (raw.length > ACQUIRE_RESULT_LENGTH) {
    decision.queueDepth = Number(raw[QUEUE_DEPTH_INDEX]);
  }
  return decision;
};

const sleep = (delayMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

/* Parked on the shared window, ahead of the request the permit would authorize. */
const waitForRetry = (delayMs: number, signal?: AbortSignal): Promise<void> => {
  if (!signal) {
    return sleep(delayMs);
  }
  /*
   * No park flag on an already-consumed deadline: it may have been eaten by a provider call
   * that takes no signal, and stamping it would exempt that from ingest backoff.
   */
  if (signal.aborted) {
    return Promise.reject(signal.reason);
  }
  return new Promise((resolve, reject) => {
    const timeoutSignal = AbortSignal.timeout(delayMs);
    const onAbort = (): void => {
      flagPacingParkAbortReason(signal.reason);
      reject(signal.reason);
    };
    const onTimeout = (): void => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    timeoutSignal.addEventListener("abort", onTimeout, { once: true });
  });
};

const createRedisRateLimiter = (
  redis: RedisScriptClient,
  key: string,
  config: RedisRateLimiterConfig,
): RedisRateLimiter => {
  const { requestsPerMinute } = config;

  const acquire = async (count: number, signal?: AbortSignal): Promise<void> => {
    widelog.count("ratelimit.acquire_count", 1);
    const startedAt = performance.now();
    let waiterToken = "";
    let joinedQueue = false;
    let granted = false;
    try {
      while (true) {
        signal?.throwIfAborted();
        const now = Date.now();
        const windowStart = now - MS_PER_MINUTE;
        const scriptArguments = [
          key,
          String(windowStart),
          String(now),
          String(count),
          String(requestsPerMinute),
        ];
        /* The uncontended attempt carries no token, so it costs one eval and never reads the queue. */
        if (waiterToken !== "") {
          scriptArguments.push(waiterToken, String(QUEUE_ENTRY_TTL_MS));
          /*
           * Marked before the call, not after: a lost reply still leaves the entry recorded
           * server-side, and only the departure eval can clear it off the head.
           */
          joinedQueue = true;
        }

        const { occupancy, queueDepth, waitTimeMs } = parseAcquireDecision(
          await measureRedisCommand(() => redis.eval(ACQUIRE_SCRIPT, 1, ...scriptArguments)),
        );
        widelog.max("ratelimit.window_occupancy_max", occupancy);
        if (typeof queueDepth === "number") {
          widelog.max("ratelimit.queue_depth_max", queueDepth);
        }

        if (waitTimeMs <= 0) {
          granted = true;
          return;
        }

        widelog.count("ratelimit.throttled_count", 1);
        if (waiterToken === "") {
          waiterToken = crypto.randomUUID();
          /* Only a parked acquire names its key: an unthrottled one waited on nothing. */
          widelog.set("wait.rate_limiter_key", key);
        }

        const sleepMs = Math.max(RETRY_POLL_MS, Math.min(waitTimeMs, MS_PER_MINUTE));
        await waitForRetry(sleepMs, signal);
      }
    } finally {
      if (joinedQueue && !granted) {
        await redis
          .eval(LEAVE_QUEUE_SCRIPT, 1, key, waiterToken)
          .catch(() => null);
      }
      recordSegment("wait.rate_limiter_ms", performance.now() - startedAt);
    }
  };

  return { acquire };
};

type GoogleRateLimitLane = "ingest" | "push";

const GOOGLE_LANE_REQUESTS_PER_MINUTE: Record<GoogleRateLimitLane, number> = {
  ingest: GOOGLE_REQUESTS_PER_MINUTE,
  push: GOOGLE_PUSH_REQUESTS_PER_MINUTE,
};

/*
 * One key for both lanes: Google's quota is per user however it is spent, so separate keys
 * would let the two jobs together sail past the real limit.
 */
const createGoogleUserRateLimiter = (
  redis: RedisScriptClient,
  userId: string,
  lane: GoogleRateLimitLane,
): RedisRateLimiter => createRedisRateLimiter(
  redis,
  `ratelimit:${userId}:google`,
  { requestsPerMinute: GOOGLE_LANE_REQUESTS_PER_MINUTE[lane] },
);

const CALDAV_ACCOUNT_REQUESTS_PER_MINUTE = 240;

const createCalDAVAccountRateLimiter = (
  redis: RedisScriptClient,
  accountId: string,
): RedisRateLimiter => createRedisRateLimiter(
  redis,
  `ratelimit:caldav-account:${accountId}`,
  { requestsPerMinute: CALDAV_ACCOUNT_REQUESTS_PER_MINUTE },
);

const HOST_REQUESTS_PER_MINUTE = 600;

interface HostRateLimiterOptions {
  requestsPerMinute?: number;
}

const createHostRateLimiter = (
  redis: RedisScriptClient,
  host: string,
  options?: HostRateLimiterOptions,
): RedisRateLimiter => createRedisRateLimiter(
  redis,
  `ratelimit:host:${host}`,
  { requestsPerMinute: options?.requestsPerMinute ?? HOST_REQUESTS_PER_MINUTE },
);

const OUTLOOK_ACCOUNT_CONCURRENCY = 3;
const OUTLOOK_LEASE_TTL_MS = 150_000;

interface OutlookAccountSemaphore {
  acquireLease(signal?: AbortSignal): Promise<SemaphoreLease>;
  release(lease: SemaphoreLease): Promise<void>;
}

const createOutlookAccountSemaphore = (
  redis: RedisLeaseClient,
  accountId: string,
): OutlookAccountSemaphore => {
  const semaphore = createLeasedSemaphore(redis, {
    capacity: OUTLOOK_ACCOUNT_CONCURRENCY,
    ttlMs: OUTLOOK_LEASE_TTL_MS,
  });
  const key = `outlook:account:${accountId}`;

  return {
    acquireLease: (signal?: AbortSignal) => semaphore.acquireLease(key, signal),
    release: (lease: SemaphoreLease) => semaphore.release(lease),
  };
};

export {
  createGoogleUserRateLimiter,
  CALDAV_ACCOUNT_REQUESTS_PER_MINUTE,
  createCalDAVAccountRateLimiter,
  createHostRateLimiter,
  createOutlookAccountSemaphore,
  createRedisRateLimiter,
};
export type {
  GoogleRateLimitLane,
  HostRateLimiterOptions,
  OutlookAccountSemaphore,
  RedisRateLimiter,
  RedisRateLimiterConfig,
  RedisScriptClient,
};
