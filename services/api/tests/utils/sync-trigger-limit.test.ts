import { describe, expect, it } from "vitest";
import {
  CALENDAR_REFRESH_COOLDOWN_SECONDS,
  checkAndClaimCalendarRefresh,
  checkAndClaimSyncTrigger,
  SYNC_TRIGGER_COOLDOWN_SECONDS,
} from "../../src/utils/sync-trigger-limit";

const createMockRedis = () => {
  const store = new Map<string, number>();

  return {
    store,
    set: (
      key: string,
      _value: string,
      _expiryFlag: string,
      seconds: number,
      _mode: string,
    ): Promise<string | null> => {
      if (store.has(key)) {
        return Promise.resolve(null);
      }
      store.set(key, seconds);
      return Promise.resolve("OK");
    },
    ttl: (key: string): Promise<number> => Promise.resolve(store.get(key) ?? -2),
  };
};

describe("checkAndClaimSyncTrigger", () => {
  it("allows the first request and claims the cooldown", async () => {
    const redis = createMockRedis();

    const result = await checkAndClaimSyncTrigger(redis as never, "user-1");

    expect(result.allowed).toBe(true);
    expect(redis.store.get("sync_trigger:user-1")).toBe(SYNC_TRIGGER_COOLDOWN_SECONDS);
  });

  it("blocks a second request inside the cooldown", async () => {
    const redis = createMockRedis();
    await checkAndClaimSyncTrigger(redis as never, "user-1");

    const result = await checkAndClaimSyncTrigger(redis as never, "user-1");

    expect(result.allowed).toBe(false);
    if (result.allowed) {
      throw new Error("Expected the second request to be throttled");
    }
    expect(result.retryAfterSeconds).toBe(SYNC_TRIGGER_COOLDOWN_SECONDS);
  });

  it("reports at least one second of remaining cooldown", async () => {
    const redis = createMockRedis();
    await checkAndClaimSyncTrigger(redis as never, "user-1");
    redis.store.set("sync_trigger:user-1", 0);

    const result = await checkAndClaimSyncTrigger(redis as never, "user-1");

    if (result.allowed) {
      throw new Error("Expected the second request to be throttled");
    }
    expect(result.retryAfterSeconds).toBe(1);
  });

  it("tracks users independently", async () => {
    const redis = createMockRedis();
    await checkAndClaimSyncTrigger(redis as never, "user-1");

    const result = await checkAndClaimSyncTrigger(redis as never, "user-2");

    expect(result.allowed).toBe(true);
  });
});

describe("checkAndClaimCalendarRefresh", () => {
  it("claims a per-account cooldown on the first refresh", async () => {
    const redis = createMockRedis();

    const result = await checkAndClaimCalendarRefresh(redis as never, "account-1");

    expect(result.allowed).toBe(true);
    expect(redis.store.get("refresh_calendars:account-1"))
      .toBe(CALENDAR_REFRESH_COOLDOWN_SECONDS);
  });

  it("blocks a second refresh of the same account inside the cooldown", async () => {
    const redis = createMockRedis();
    await checkAndClaimCalendarRefresh(redis as never, "account-1");

    const result = await checkAndClaimCalendarRefresh(redis as never, "account-1");

    if (result.allowed) {
      throw new Error("Expected the second refresh to be throttled");
    }
    expect(result.retryAfterSeconds).toBe(CALENDAR_REFRESH_COOLDOWN_SECONDS);
  });

  it("reports at least one second of remaining cooldown", async () => {
    const redis = createMockRedis();
    await checkAndClaimCalendarRefresh(redis as never, "account-1");
    redis.store.set("refresh_calendars:account-1", 0);

    const result = await checkAndClaimCalendarRefresh(redis as never, "account-1");

    if (result.allowed) {
      throw new Error("Expected the second refresh to be throttled");
    }
    expect(result.retryAfterSeconds).toBe(1);
  });

  it("throttles one account without blocking another account of the same user", async () => {
    const redis = createMockRedis();
    await checkAndClaimCalendarRefresh(redis as never, "account-1");

    const result = await checkAndClaimCalendarRefresh(redis as never, "account-2");

    expect(result.allowed).toBe(true);
  });

  it("keeps the sync trigger cooldown on its own key", async () => {
    const redis = createMockRedis();
    await checkAndClaimCalendarRefresh(redis as never, "user-1");

    const result = await checkAndClaimSyncTrigger(redis as never, "user-1");

    expect(result.allowed).toBe(true);
  });
});
