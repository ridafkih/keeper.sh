import { describe, expect, it, vi } from "vitest";
import { createSafeFetch } from "@keeper.sh/calendar/safe-fetch";
import type { SafeFetchOptions } from "@keeper.sh/calendar/safe-fetch";

const capturedConfigs: { safeFetchOptions?: SafeFetchOptions }[] = [];

vi.mock("@keeper.sh/calendar/caldav", () => ({
  createCalDAVSyncProvider: (config: { safeFetchOptions?: SafeFetchOptions }) => {
    capturedConfigs.push(config);
    return { name: "caldav" };
  },
}));

vi.mock("@keeper.sh/database", () => ({
  decryptPassword: () => "password",
}));

const { resolveSyncProvider } = await import("../src/resolve-provider");

const createDatabaseStub = (row: Record<string, unknown>) => {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    limit: () => Promise.resolve([row]),
  };
  return { select: () => chain };
};

const resolveCalDAVSafeFetchOptions = async (): Promise<SafeFetchOptions> => {
  capturedConfigs.length = 0;

  const database = createDatabaseStub({
    authMethod: "Basic",
    username: "user",
    encryptedPassword: "encrypted",
    serverUrl: "https://caldav.example.com/dav/",
    calendarUrl: "https://caldav.example.com/dav/calendars/user/default/",
  });

  await resolveSyncProvider({
    database: database as never,
    provider: "caldav",
    calendarId: "calendar-1",
    userId: "user-1",
    accountId: "account-1",
    oauthConfig: {},
    encryptionKey: "key",
  });

  const [config] = capturedConfigs;
  if (!config?.safeFetchOptions) {
    throw new Error("the CalDAV destination provider was constructed without safeFetchOptions");
  }

  return config.safeFetchOptions;
};

describe("resolveSyncProvider CalDAV destination outbound fetch", () => {
  it("guards the destination provider against private address resolution", async () => {
    const options = await resolveCalDAVSafeFetchOptions();

    expect(options.blockPrivateResolution).toBe(true);
  });

  it("refuses to reach a loopback CalDAV server with the options the destination path builds", async () => {
    const options = await resolveCalDAVSafeFetchOptions();

    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("INTERNAL-SECRET"),
    });

    const safeFetch = createSafeFetch(options);

    try {
      await expect(safeFetch(`http://127.0.0.1:${server.port}/dav/`)).rejects.toThrow(
        /private or reserved network address/,
      );
    } finally {
      server.stop(true);
    }
  });
});
