import { describe, expect, it, vi } from "vitest";
import {
  CALDAV_DISCOVERY_TTL_SECONDS,
  createCalendarDiscoveryCache,
  invalidateCalendarDiscoveryCache,
  parseCachedCalendars,
} from "../../../src/providers/caldav/shared/discovery-cache";

const CALENDARS = [{ ctag: "1", displayName: "Work", url: "https://dav.example/work/" }];

const fakeRedis = () => {
  const store = new Map<string, string>();
  return {
    del: vi.fn((...keys: string[]) => {
      let removed = 0;
      for (const key of keys) {
        if (store.delete(key)) {
          removed++;
        }
      }
      return Promise.resolve(removed);
    }),
    get: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setex: vi.fn((key: string, _seconds: number, value: string) => {
      store.set(key, value);
      return Promise.resolve("OK");
    }),
    store,
  };
};

describe("CalDAV discovery cache", () => {
  it("returns nothing until a walk has been written", async () => {
    const cache = createCalendarDiscoveryCache(fakeRedis(), "account-1");

    await expect(cache.read()).resolves.toBeNull();
  });

  it("returns the written walk on the next read", async () => {
    const cache = createCalendarDiscoveryCache(fakeRedis(), "account-1");

    await cache.write(CALENDARS);

    await expect(cache.read()).resolves.toEqual(CALENDARS);
  });

  it("expires the entry so a calendar added elsewhere appears unprompted", async () => {
    const redis = fakeRedis();

    await createCalendarDiscoveryCache(redis, "account-1").write(CALENDARS);

    expect(redis.setex.mock.calls[0]?.[1]).toBe(CALDAV_DISCOVERY_TTL_SECONDS);
    expect(CALDAV_DISCOVERY_TTL_SECONDS).toBe(900);
  });

  it("keeps two accounts on separate entries", async () => {
    const redis = fakeRedis();

    await createCalendarDiscoveryCache(redis, "account-1").write(CALENDARS);

    await expect(createCalendarDiscoveryCache(redis, "account-2").read()).resolves.toBeNull();
  });

  it("forgets the walk once the account is refreshed by hand", async () => {
    const redis = fakeRedis();
    const cache = createCalendarDiscoveryCache(redis, "account-1");
    await cache.write(CALENDARS);

    await invalidateCalendarDiscoveryCache(redis, "account-1");

    await expect(cache.read()).resolves.toBeNull();
  });

  it("treats an unreadable entry as a miss rather than failing the ingest", () => {
    expect(parseCachedCalendars("not json")).toBeNull();
    expect(parseCachedCalendars("{}")).toBeNull();
    expect(parseCachedCalendars('[{"url":1}]')).toBeNull();
  });
});
