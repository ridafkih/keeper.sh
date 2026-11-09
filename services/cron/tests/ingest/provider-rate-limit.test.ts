import { describe, expect, it } from "vitest";
import type { RedisRateLimiter } from "@keeper.sh/calendar";
import { withProviderRateLimit } from "../../src/ingest/provider-rate-limit";

const recordingLimiter = (name: string, calls: string[]): RedisRateLimiter => ({
  acquire: (count) => {
    calls.push(`${name}:${count}`);
    return Promise.resolve();
  },
});

describe("withProviderRateLimit", () => {
  it("returns the account limiter untouched when no provider limit is set", () => {
    const limiter = recordingLimiter("account", []);

    expect(withProviderRateLimit(null, limiter)).toBe(limiter);
  });

  it("leaves a source without its own limiter unlimited", () => {
    const accountLimiter = new Map<string, RedisRateLimiter>().get("account");

    expect(withProviderRateLimit(recordingLimiter("provider", []), accountLimiter)).toBeUndefined();
  });

  it("takes from the provider budget before the account budget", async () => {
    const calls: string[] = [];
    const limiter = withProviderRateLimit(
      recordingLimiter("provider", calls),
      recordingLimiter("account", calls),
    );

    await limiter?.acquire(3);

    expect(calls).toEqual(["provider:3", "account:3"]);
  });

  it("charges the provider budget once per permit and keeps the account permit", async () => {
    const calls: string[] = [];
    const released: string[] = [];
    const account: RedisRateLimiter = {
      acquire: () => Promise.resolve(),
      acquirePermit: () => {
        calls.push("account-permit");
        return Promise.resolve({
          release: () => {
            released.push("account-permit");
            return Promise.resolve();
          },
        });
      },
    };
    const limiter = withProviderRateLimit(recordingLimiter("provider", calls), account);

    const permit = await limiter?.acquirePermit?.();
    await permit?.release();

    expect(calls).toEqual(["provider:1", "account-permit"]);
    expect(released).toEqual(["account-permit"]);
  });

  it("offers no permit when the account limiter has none", () => {
    const limiter = withProviderRateLimit(
      recordingLimiter("provider", []),
      recordingLimiter("account", []),
    );

    expect(limiter?.acquirePermit).toBeUndefined();
  });
});
