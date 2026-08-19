import { describe, expect, it, vi } from "vitest";
import {
  CALDAV_ACCOUNT_REQUESTS_PER_MINUTE,
  createCalDAVAccountRateLimiter,
  createHostRateLimiter,
} from "../../../src/core/utils/redis-rate-limiter";

const acquireArguments = async (
  limiter: { acquire: (cost: number) => Promise<void> },
  redis: { eval: ReturnType<typeof vi.fn> },
): Promise<string[]> => {
  await limiter.acquire(1);
  return vi.mocked(redis.eval).mock.calls[0]?.slice(2) as string[];
};

describe("createCalDAVAccountRateLimiter", () => {
  it("meters two accounts on one hostname against separate keys", async () => {
    const first = { eval: vi.fn(() => Promise.resolve([0, 0])) };
    const second = { eval: vi.fn(() => Promise.resolve([0, 0])) };

    const [firstKey] = await acquireArguments(
      createCalDAVAccountRateLimiter(first, "account-one"),
      first,
    );
    const [secondKey] = await acquireArguments(
      createCalDAVAccountRateLimiter(second, "account-two"),
      second,
    );

    expect(firstKey).toBe("ratelimit:caldav-account:account-one");
    expect(secondKey).toBe("ratelimit:caldav-account:account-two");
    expect(firstKey).not.toBe(secondKey);
  });

  it("never shares a key with the host budget it replaces", async () => {
    const account = { eval: vi.fn(() => Promise.resolve([0, 0])) };
    const host = { eval: vi.fn(() => Promise.resolve([0, 0])) };

    const [accountKey] = await acquireArguments(
      createCalDAVAccountRateLimiter(account, "account-one"),
      account,
    );
    const [hostKey] = await acquireArguments(
      createHostRateLimiter(host, "caldav.icloud.com"),
      host,
    );

    expect(accountKey).not.toBe(hostKey);
  });

  it("meters the account at the documented per-mailbox rate", async () => {
    const redis = { eval: vi.fn(() => Promise.resolve([0, 0])) };

    const args = await acquireArguments(
      createCalDAVAccountRateLimiter(redis, "account-one"),
      redis,
    );

    expect(args).toContain(String(CALDAV_ACCOUNT_REQUESTS_PER_MINUTE));
    expect(CALDAV_ACCOUNT_REQUESTS_PER_MINUTE).toBe(240);
  });
});
