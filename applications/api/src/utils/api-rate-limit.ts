import type Redis from "ioredis";

const FREE_DAILY_LIMIT = 25;
const SECONDS_PER_DAY = 86_400;

const buildDailyKey = (userId: string): string => {
  const date = new Date().toISOString().slice(0, 10);
  return `api_usage:${userId}:${date}`;
};

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
}

const checkAndIncrementApiUsage = async (
  redisClient: Redis,
  userId: string,
  plan: "free" | "pro" | null,
): Promise<RateLimitResult> => {
  if (plan === "pro") {
    return { allowed: true, remaining: -1, limit: -1 };
  }

  const key = buildDailyKey(userId);
  const currentCount = await redisClient.incr(key);

  if (currentCount === 1) {
    await redisClient.expire(key, SECONDS_PER_DAY);
  }

  const allowed = currentCount <= FREE_DAILY_LIMIT;
  const remaining = Math.max(0, FREE_DAILY_LIMIT - currentCount);

  return { allowed, remaining, limit: FREE_DAILY_LIMIT };
};

export { checkAndIncrementApiUsage, FREE_DAILY_LIMIT };
export type { RateLimitResult };
