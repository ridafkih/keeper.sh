import { describe, expect, it, vi } from "vitest";
import { createHostRateLimiter } from "../../../src/core/utils/redis-rate-limiter";

const DEFAULT_HOST_REQUESTS_PER_WINDOW = 600;

const acquireArguments = async (host: string): Promise<string[]> => {
  const redis = { eval: vi.fn(() => Promise.resolve([0, 0])) };
  await createHostRateLimiter(redis, host).acquire(1);
  return vi.mocked(redis.eval).mock.calls[0]?.slice(2) as string[];
};

describe("createHostRateLimiter", () => {
  it("meters two limiters for the same host against one shared key", async () => {
    const [firstKey] = await acquireArguments("caldav.fastmail.com");
    const [secondKey] = await acquireArguments("caldav.fastmail.com");

    expect(firstKey).toContain("caldav.fastmail.com");
    expect(secondKey).toBe(firstKey);
  });

  it("keys different hosts independently so one host cannot starve another", async () => {
    const [fastmailKey] = await acquireArguments("caldav.fastmail.com");
    const [icloudKey] = await acquireArguments("caldav.icloud.com");

    expect(fastmailKey).not.toBe(icloudKey);
  });

  it("defaults to a budget that spans many calendars on a shared host", async () => {
    const limitArguments = await acquireArguments("caldav.fastmail.com");

    expect(Number(limitArguments.at(-1))).toBe(DEFAULT_HOST_REQUESTS_PER_WINDOW);
  });

  it("waits for the window instead of proceeding when the host budget is spent", async () => {
    vi.useFakeTimers();
    try {
      const redis = {
        eval: vi
          .fn()
          .mockResolvedValueOnce([250, DEFAULT_HOST_REQUESTS_PER_WINDOW])
          .mockResolvedValueOnce([0, 0]),
      };
      if (typeof createHostRateLimiter !== "function") {
        throw new TypeError("createHostRateLimiter is not exported from redis-rate-limiter");
      }
      const limiter = createHostRateLimiter(redis, "caldav.fastmail.com");

      let resolved = false;
      const pending = limiter.acquire(1).then(() => {
        resolved = true;
        return null;
      });

      await vi.advanceTimersByTimeAsync(50);
      expect(resolved).toBe(false);
      expect(redis.eval).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(60_000);
      await pending;
      expect(resolved).toBe(true);
      expect(redis.eval).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
