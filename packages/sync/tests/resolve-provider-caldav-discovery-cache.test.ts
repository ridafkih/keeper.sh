import { describe, expect, it, vi } from "vitest";

const capturedConfigs: { calendarDiscoveryCache?: unknown }[] = [];
const cacheAccounts: string[] = [];

vi.mock("@keeper.sh/calendar/caldav", () => ({
  createCalDAVSyncProvider: (config: { calendarDiscoveryCache?: unknown }) => {
    capturedConfigs.push(config);
    return { name: "caldav" };
  },
  createCalendarDiscoveryCache: (_redis: unknown, accountId: string) => {
    cacheAccounts.push(accountId);
    return { accountId };
  },
}));

vi.mock("@keeper.sh/database", () => ({
  decryptPassword: () => "password",
}));

const { resolveSyncProvider } = await import("../src/resolve-provider");

const createDatabaseStub = () => {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    limit: () => Promise.resolve([{
      authMethod: "Basic",
      calendarUrl: "https://caldav.example.com/dav/calendars/user/default/",
      encryptedPassword: "encrypted",
      serverUrl: "https://caldav.example.com/dav/",
      username: "user",
    }]),
  };
  return { select: () => chain };
};

const resolveCalDAVConfig = async (
  discoveryCacheRedis?: { get: () => Promise<null>; setex: () => Promise<unknown> },
) => {
  capturedConfigs.length = 0;
  cacheAccounts.length = 0;

  await resolveSyncProvider({
    accountId: "account-1",
    calendarId: "calendar-1",
    database: createDatabaseStub() as never,
    discoveryCacheRedis,
    encryptionKey: "key",
    oauthConfig: {},
    provider: "caldav",
    userId: "user-1",
  });

  return capturedConfigs[0];
};

describe("resolveSyncProvider CalDAV discovery cache", () => {
  it("keys the destination's discovery cache by the account, as ingest does", async () => {
    const redis = { get: () => Promise.resolve(null), setex: () => Promise.resolve("OK") };

    const config = await resolveCalDAVConfig(redis);

    expect(cacheAccounts).toEqual(["account-1"]);
    expect(config?.calendarDiscoveryCache).toEqual({ accountId: "account-1" });
  });

  it("builds the provider without a cache when no Redis is supplied", async () => {
    const config = await resolveCalDAVConfig();

    expect(cacheAccounts).toEqual([]);
    expect(config).toBeDefined();
    expect(config).not.toHaveProperty("calendarDiscoveryCache");
  });
});
