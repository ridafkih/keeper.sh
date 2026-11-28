import { GOOGLE_PUSH_REQUESTS_PER_MINUTE } from "@keeper.sh/constants";
import type { AccountThrottlePolicy } from "@keeper.sh/constants";
import { describe, expect, it, vi } from "vitest";
import { createAdaptiveAccountLimiter } from "../../../src/core/utils/adaptive-account-throttle";
import {
  createGoogleUserRateLimiter,
  createRedisRateLimiter,
  withGoogleProjectBudget,
} from "../../../src/core/utils/redis-rate-limiter";
import type { RedisScriptClient } from "../../../src/core/utils/redis-rate-limiter";

const POLICY: AccountThrottlePolicy = {
  initialCooldownMs: 30_000,
  jitterRatio: 0.2,
  maximumCooldownMs: 900_000,
  maximumParkMs: 15_000,
  minimumRequestsPerMinute: 15,
  recoveryWindowMs: 600_000,
  requestsPerMinute: 240,
};

const createStateRedis = (): RedisScriptClient => {
  const values = new Map<string, string>();
  return {
    eval: (script: string, _keys: number, ...args: string[]) => {
      const [key = "", value = ""] = args;
      if (script.includes("'SET'")) {
        values.set(key, value);
        return Promise.resolve(1);
      }
      return Promise.resolve(values.get(key) ?? null);
    },
  };
};

describe("a limiter's current pace", () => {
  it("reports the configured pace of a fixed limiter without touching Redis", async () => {
    const redis = { eval: vi.fn(() => Promise.resolve([0, 0])) };
    const limiter = createRedisRateLimiter(redis, "rate-limit", { requestsPerMinute: 300 });

    await expect(limiter.currentRequestsPerMinute?.()).resolves.toBe(300);
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it("reports the per-user push pace for Google when the project budget is wider", async () => {
    const redis = { eval: vi.fn(() => Promise.resolve([0, 0])) };
    const limiter = withGoogleProjectBudget(
      redis,
      createGoogleUserRateLimiter(redis, "user-id", "push"),
      10_000,
    );

    await expect(limiter.currentRequestsPerMinute?.()).resolves.toBe(GOOGLE_PUSH_REQUESTS_PER_MINUTE);
  });

  it("reports the project's background share when it is narrower than the per-user pace", async () => {
    const redis = { eval: vi.fn(() => Promise.resolve([0, 0])) };
    const limiter = withGoogleProjectBudget(
      redis,
      createGoogleUserRateLimiter(redis, "user-id", "push"),
      100,
    );

    await expect(limiter.currentRequestsPerMinute?.()).resolves.toBe(90);
  });

  it("halves an adaptive account's pace after each throttle", async () => {
    const limiter = createAdaptiveAccountLimiter(createStateRedis(), "ratelimit:caldav-account:a", POLICY, {
      now: () => 1_000_000,
      random: () => 0,
    });

    await expect(limiter.currentRequestsPerMinute()).resolves.toBe(240);
    await limiter.reportThrottle(null);
    await expect(limiter.currentRequestsPerMinute()).resolves.toBe(120);
  });
});
