import { GOOGLE_REQUESTS_PER_MINUTE } from "@keeper.sh/constants";
import { describe, expect, it, vi } from "vitest";
import {
  createGoogleUserRateLimiter,
  createRedisRateLimiter,
} from "../../../src/core/utils/redis-rate-limiter";

describe("createRedisRateLimiter", () => {
  it("returns immediately when Redis grants capacity", async () => {
    const redis = { eval: vi.fn(() => Promise.resolve([0, 0])) };
    const limiter = createRedisRateLimiter(redis, "rate-limit", {
      requestsPerMinute: 10,
    });

    await expect(limiter.acquire(1)).resolves.toBeUndefined();
    expect(redis.eval).toHaveBeenCalledOnce();
  });

  it("aborts while waiting for capacity", async () => {
    const redis = { eval: vi.fn(() => Promise.resolve([60_000, 10])) };
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

describe("createGoogleUserRateLimiter", () => {
  const acquireArguments = async (lane: "ingest" | "push"): Promise<string[]> => {
    const redis = { eval: vi.fn(() => Promise.resolve([0, 0])) };
    await createGoogleUserRateLimiter(redis, "user-id", lane).acquire(1);
    return vi.mocked(redis.eval).mock.calls[0]?.slice(2) as string[];
  };

  it("meters both lanes against one key so the per-user quota is never doubled", async () => {
    const [ingestKey] = await acquireArguments("ingest");
    const [pushKey] = await acquireArguments("push");

    expect(ingestKey).toBe("ratelimit:user-id:google");
    expect(pushKey).toBe(ingestKey);
  });

  it("caps destination push below the quota so ingestion keeps reserved headroom", async () => {
    const ingestArguments = await acquireArguments("ingest");
    const pushArguments = await acquireArguments("push");
    const ingestLimit = Number(ingestArguments.at(-1));
    const pushLimit = Number(pushArguments.at(-1));

    expect(ingestLimit).toBe(GOOGLE_REQUESTS_PER_MINUTE);
    expect(pushLimit).toBeLessThan(GOOGLE_REQUESTS_PER_MINUTE);
  });
});
