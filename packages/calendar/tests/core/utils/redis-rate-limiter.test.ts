import { describe, expect, it, vi } from "vitest";
import { createRedisRateLimiter } from "../../../src/core/utils/redis-rate-limiter";

describe("createRedisRateLimiter", () => {
  it("returns immediately when Redis grants capacity", async () => {
    const redis = { eval: vi.fn(() => Promise.resolve(0)) };
    const limiter = createRedisRateLimiter(redis, "rate-limit", {
      requestsPerMinute: 10,
    });

    await expect(limiter.acquire(1)).resolves.toBeUndefined();
    expect(redis.eval).toHaveBeenCalledOnce();
  });

  it("aborts while waiting for capacity", async () => {
    const redis = { eval: vi.fn(() => Promise.resolve(60_000)) };
    const limiter = createRedisRateLimiter(redis, "rate-limit", {
      requestsPerMinute: 10,
    });
    const controller = new AbortController();
    const result = limiter.acquire(1, controller.signal);

    controller.abort(new Error("source deadline exceeded"));

    await expect(result).rejects.toThrow("source deadline exceeded");
    expect(redis.eval).toHaveBeenCalledOnce();
  });
});
