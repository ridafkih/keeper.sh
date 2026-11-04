import type { RedisRateLimiter } from "@keeper.sh/calendar";

const withProviderRateLimit = (
  providerLimiter: RedisRateLimiter | null,
  limiter: RedisRateLimiter | undefined,
): RedisRateLimiter | undefined => {
  if (!providerLimiter || !limiter) {
    return limiter;
  }
  const { acquirePermit } = limiter;
  const composite: RedisRateLimiter = {
    acquire: async (count, signal) => {
      await providerLimiter.acquire(count, signal);
      await limiter.acquire(count, signal);
    },
  };
  if (acquirePermit) {
    composite.acquirePermit = async (signal) => {
      await providerLimiter.acquire(1, signal);
      return acquirePermit(signal);
    };
  }
  return composite;
};

export { withProviderRateLimit };
