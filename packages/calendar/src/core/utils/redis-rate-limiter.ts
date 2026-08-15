import {
  GOOGLE_PUSH_REQUESTS_PER_MINUTE,
  GOOGLE_REQUESTS_PER_MINUTE,
} from "@keeper.sh/constants";
import { widelog } from "widelogger";
import { measureRedisCommand, recordSegment } from "../telemetry/segments";

const MS_PER_MINUTE = 60_000;
const RETRY_POLL_MS = 100;
const ACQUIRE_RESULT_LENGTH = 2;

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
 * Lua script for atomic sliding window rate limiting.
 *
 * KEYS[1] = sorted set key
 * ARGV[1] = window start (now - 60s) in ms
 * ARGV[2] = current time in ms
 * ARGV[3] = count of slots to acquire
 * ARGV[4] = max requests per minute
 *
 * Returns { waitTime, occupancy }:
 *   waitTime 0 = acquired successfully
 *   waitTime > 0 = wait time in ms before retrying
 *   occupancy = slots already held in the window when the decision was taken
 */
const ACQUIRE_SCRIPT = `
  redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
  local current = redis.call('ZCARD', KEYS[1])
  local count = tonumber(ARGV[3])
  local limit = tonumber(ARGV[4])
  local now = tonumber(ARGV[2])

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
`;

interface AcquireDecision {
  occupancy: number;
  waitTimeMs: number;
}

const parseAcquireDecision = (raw: unknown): AcquireDecision => {
  if (!Array.isArray(raw) || raw.length < ACQUIRE_RESULT_LENGTH) {
    throw new Error("Rate limiter acquire script returned an unexpected result shape");
  }
  return { occupancy: Number(raw[1]), waitTimeMs: Number(raw[0]) };
};

const inProcessWaitersByKey = new Map<string, number>();

const enterRateLimiterQueue = (key: string): number => {
  const depth = (inProcessWaitersByKey.get(key) ?? 0) + 1;
  inProcessWaitersByKey.set(key, depth);
  return depth;
};

const leaveRateLimiterQueue = (key: string): void => {
  const depth = (inProcessWaitersByKey.get(key) ?? 1) - 1;
  if (depth <= 0) {
    inProcessWaitersByKey.delete(key);
    return;
  }
  inProcessWaitersByKey.set(key, depth);
};

const sleep = (delayMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

const waitForRetry = (delayMs: number, signal?: AbortSignal): Promise<void> => {
  if (!signal) {
    return sleep(delayMs);
  }
  if (signal.aborted) {
    return Promise.reject(signal.reason);
  }
  return new Promise((resolve, reject) => {
    const timeoutSignal = AbortSignal.timeout(delayMs);
    const onAbort = (): void => {
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
    let queued = false;
    try {
      while (true) {
        signal?.throwIfAborted();
        const now = Date.now();
        const windowStart = now - MS_PER_MINUTE;

        const { occupancy, waitTimeMs } = parseAcquireDecision(await measureRedisCommand(() =>
          redis.eval(
            ACQUIRE_SCRIPT,
            1,
            key,
            String(windowStart),
            String(now),
            String(count),
            String(requestsPerMinute),
          )));
        widelog.max("ratelimit.window_occupancy_max", occupancy);

        if (waitTimeMs <= 0) {
          return;
        }

        widelog.count("ratelimit.throttled_count", 1);
        if (!queued) {
          queued = true;
          widelog.max("ratelimit.queue_depth_max", enterRateLimiterQueue(key));
        }

        const sleepMs = Math.max(RETRY_POLL_MS, Math.min(waitTimeMs, MS_PER_MINUTE));
        await waitForRetry(sleepMs, signal);
      }
    } finally {
      if (queued) {
        leaveRateLimiterQueue(key);
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
 * One key for both lanes: Google's quota is per user however it is spent, so separate
 * keys would let the two jobs together sail past the real limit. The lanes differ only
 * in how much of that shared key each may claim, which reserves headroom for ingestion
 * without raising the total.
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

export { createGoogleUserRateLimiter, createRedisRateLimiter };
export type {
  GoogleRateLimitLane,
  RedisRateLimiter,
  RedisRateLimiterConfig,
  RedisScriptClient,
};
