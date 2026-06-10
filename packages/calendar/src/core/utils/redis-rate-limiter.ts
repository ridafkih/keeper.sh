import type Redis from "ioredis";

const MS_PER_MINUTE = 60_000;
const RETRY_POLL_MS = 100;

interface RedisRateLimiter {
  acquire(count: number): Promise<void>;
}

interface RedisRateLimiterConfig {
  requestsPerMinute: number;
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
 * Returns:
 *   0 = acquired successfully
 *   N > 0 = wait time in ms before retrying
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
    return 0
  end

  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  if #oldest >= 2 then
    local oldestScore = tonumber(oldest[2])
    return oldestScore + 60000 - now
  end

  return 1000
`;

const createRedisRateLimiter = (
  redis: Redis,
  key: string,
  config: RedisRateLimiterConfig,
): RedisRateLimiter => {
  const { requestsPerMinute } = config;

  const acquire = async (count: number): Promise<void> => {
    while (true) {
      const now = Date.now();
      const windowStart = now - MS_PER_MINUTE;

      const waitTime = Number((await redis.eval(
        ACQUIRE_SCRIPT,
        1,
        key,
        String(windowStart),
        String(now),
        String(count),
        String(requestsPerMinute),
      )));

      if (waitTime <= 0) {
        return;
      }

      const sleepMs = Math.max(RETRY_POLL_MS, Math.min(waitTime, MS_PER_MINUTE));
      await Bun.sleep(sleepMs);
    }
  };

  return { acquire };
};

export { createRedisRateLimiter };
export type { RedisRateLimiter, RedisRateLimiterConfig };
