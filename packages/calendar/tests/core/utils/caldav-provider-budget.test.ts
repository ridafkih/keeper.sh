import { describe, expect, it, vi } from "vitest";
import {
  FASTMAIL_ACCOUNT_REQUESTS_PER_MINUTE,
  ICLOUD_ACCOUNT_REQUESTS_PER_MINUTE,
  createCalDAVAccountRateLimiter,
  createHostRateLimiter,
} from "../../../src/core/utils/redis-rate-limiter";
import type { RedisScriptClient } from "../../../src/core/utils/redis-rate-limiter";
import { getCalDAVAccountRequestsPerMinute } from "../../../src/utils/registry/registry";

const acquireArguments = async (
  limiter: { acquire: (cost: number) => Promise<void> },
  redis: { eval: ReturnType<typeof vi.fn> },
): Promise<string[]> => {
  await limiter.acquire(1);
  const [call] = vi.mocked(redis.eval).mock.calls;
  if (!call) {
    throw new Error("rate limiter never evaluated its acquire script");
  }
  return call.slice(2).map(String);
};

const grantingRedis = (): RedisScriptClient & { eval: ReturnType<typeof vi.fn> } => ({
  eval: vi.fn(() => Promise.resolve([0, 0])),
});

describe("each hosted CalDAV provider carries its own budget", () => {
  it("resolves a separate per-minute budget for iCloud and for Fastmail", () => {
    expect(getCalDAVAccountRequestsPerMinute("icloud")).toBe(
      ICLOUD_ACCOUNT_REQUESTS_PER_MINUTE,
    );
    expect(getCalDAVAccountRequestsPerMinute("fastmail")).toBe(
      FASTMAIL_ACCOUNT_REQUESTS_PER_MINUTE,
    );
  });

  it("holds both hosted providers at the same 240 until telemetry says otherwise", () => {
    expect(ICLOUD_ACCOUNT_REQUESTS_PER_MINUTE).toBe(240);
    expect(FASTMAIL_ACCOUNT_REQUESTS_PER_MINUTE).toBe(240);
  });

  it("meters each hosted account on its own key at its own resolved budget", async () => {
    const icloudRedis = grantingRedis();
    const fastmailRedis = grantingRedis();

    const icloudArguments = await acquireArguments(
      createCalDAVAccountRateLimiter(
        icloudRedis,
        "icloud-account",
        getCalDAVAccountRequestsPerMinute("icloud"),
      ),
      icloudRedis,
    );
    const fastmailArguments = await acquireArguments(
      createCalDAVAccountRateLimiter(
        fastmailRedis,
        "fastmail-account",
        getCalDAVAccountRequestsPerMinute("fastmail"),
      ),
      fastmailRedis,
    );

    expect(icloudArguments[0]).toBe("ratelimit:caldav-account:icloud-account");
    expect(fastmailArguments[0]).toBe("ratelimit:caldav-account:fastmail-account");
    expect(icloudArguments).toContain(String(ICLOUD_ACCOUNT_REQUESTS_PER_MINUTE));
    expect(fastmailArguments).toContain(String(FASTMAIL_ACCOUNT_REQUESTS_PER_MINUTE));
  });

  it("keeps a safe account budget when no caller supplies one", async () => {
    const redis = grantingRedis();

    const args = await acquireArguments(
      createCalDAVAccountRateLimiter(redis, "unknown-account"),
      redis,
    );

    expect(args[0]).toBe("ratelimit:caldav-account:unknown-account");
    expect(args).toContain("240");
  });

  it("gives a self-hosted CalDAV server no account budget, leaving it the host limiter", async () => {
    expect(getCalDAVAccountRequestsPerMinute("caldav")).toBeUndefined();

    const redis = grantingRedis();
    const args = await acquireArguments(
      createHostRateLimiter(redis, "calendar.self-hosted.example"),
      redis,
    );

    expect(args[0]).toBe("ratelimit:host:calendar.self-hosted.example");
    expect(args).toContain("600");
  });

  it("claims no account budget for a provider that does not speak CalDAV", () => {
    expect(getCalDAVAccountRequestsPerMinute("google")).toBeUndefined();
    expect(getCalDAVAccountRequestsPerMinute("outlook")).toBeUndefined();
    expect(getCalDAVAccountRequestsPerMinute("ics")).toBeUndefined();
  });
});
