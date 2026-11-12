import { describe, expect, it, vi } from "vitest";

const walks = vi.hoisted(() => ({ listCalendars: vi.fn() }));

vi.mock("tsdav", async () => {
  const { answerDiscoveryPropfind } = await import("../discovery-propfind");
  return {
    DAVNamespaceShort: { DAV: "d" },
    createDAVClient: () => Promise.resolve({
      calendarQuery: () => Promise.resolve([]),
      propfind: answerDiscoveryPropfind(() => walks.listCalendars()),
    }),
  };
});

const { createCalDAVSyncProvider } = await import("../../../../src/providers/caldav/destination/provider");
const { createCalendarDiscoveryCache } = await import("../../../../src/providers/caldav/shared/discovery-cache");

const DISCOVERED = [{
  components: ["VEVENT"],
  ctag: "1",
  displayName: "Work",
  url: "https://dav.example/work/",
}];

const LIST_OPTIONS = {
  timeMax: new Date("2026-12-31T00:00:00.000Z"),
  timeMin: new Date("2026-01-01T00:00:00.000Z"),
};

const fakeRedis = () => {
  const store = new Map<string, string>();
  return {
    get: (key: string) => Promise.resolve(store.get(key) ?? null),
    setex: (key: string, _seconds: number, value: string) => {
      store.set(key, value);
      return Promise.resolve("OK");
    },
  };
};

const createProvider = (redis?: ReturnType<typeof fakeRedis>) => createCalDAVSyncProvider({
  ...redis && { calendarDiscoveryCache: createCalendarDiscoveryCache(redis, "account-1") },
  calendarUrl: "https://dav.example/work/",
  password: "secret",
  serverUrl: "https://dav.example/",
  username: "rida",
});

describe("CalDAV destination discovery cache", () => {
  it("walks the account once across pushes that share the cache", async () => {
    walks.listCalendars.mockClear().mockResolvedValue(DISCOVERED);
    const redis = fakeRedis();

    await createProvider(redis).listRemoteEvents(LIST_OPTIONS);
    await createProvider(redis).listRemoteEvents(LIST_OPTIONS);

    expect(walks.listCalendars).toHaveBeenCalledTimes(1);
  });

  it("reuses a walk the ingest path already cached for the same account", async () => {
    walks.listCalendars.mockClear().mockResolvedValue(DISCOVERED);
    const redis = fakeRedis();
    await createCalendarDiscoveryCache(redis, "account-1").write([
      { displayName: "Work", url: "https://dav.example/work/", writable: true },
    ]);

    await createProvider(redis).listRemoteEvents(LIST_OPTIONS);

    expect(walks.listCalendars).not.toHaveBeenCalled();
  });

  it("walks on every push when no cache is supplied", async () => {
    walks.listCalendars.mockClear().mockResolvedValue(DISCOVERED);

    await createProvider().listRemoteEvents(LIST_OPTIONS);
    await createProvider().listRemoteEvents(LIST_OPTIONS);

    expect(walks.listCalendars).toHaveBeenCalledTimes(2);
  });
});
