import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import type { createCalDAVSource as createCalDAVSourceFn } from "../../src/utils/caldav-sources";
import type {
  createOAuthSource as createOAuthSourceFn,
  importOAuthAccountCalendars as importOAuthAccountCalendarsFn,
} from "../../src/utils/oauth-sources";

const COLD_IMPORT_TIMEOUT_MS = 30_000;
let createCalDAVSource: typeof createCalDAVSourceFn = () =>
  Promise.reject(new Error("Module not loaded"));
let createOAuthSource: typeof createOAuthSourceFn = () =>
  Promise.reject(new Error("Module not loaded"));
let importOAuthAccountCalendars: typeof importOAuthAccountCalendarsFn = () =>
  Promise.reject(new Error("Module not loaded"));

let canAddAccountResult = true;
let googleCalendars = [{ id: "external-1", summary: "Team Calendar" }];
let insertCalls: unknown[] = [];
let selectResults: unknown[][] = [];
let triggerSyncCalls: string[] = [];
let spawnedJobNames: string[] = [];
let txInstance: object = {};

type SelectPromise = Promise<unknown[]> & {
  from: () => SelectPromise;
  innerJoin: () => SelectPromise;
  leftJoin: () => SelectPromise;
  where: () => SelectPromise;
  limit: () => Promise<unknown[]>;
};

const createSelectBuilder = (result: unknown[]): SelectPromise => {
  const chain = Promise.resolve(result) as SelectPromise;
  chain.from = () => chain;
  chain.innerJoin = () => chain;
  chain.leftJoin = () => chain;
  chain.where = () => chain;
  chain.limit = () => Promise.resolve(result);
  return chain;
};

const createTrackedInsertBuilder = (result: unknown, track: boolean) => ({
  values: (values: unknown) => {
    if (track) {
      insertCalls.push(values);
    }

    const conflictChain = Promise.resolve() as Promise<void> & {
      returning: () => Promise<unknown>;
    };
    conflictChain.returning = () => Promise.resolve(result);

    const valueChain = Promise.resolve() as Promise<void> & {
      onConflictDoNothing: () => typeof conflictChain;
      onConflictDoUpdate: () => { returning: () => Promise<unknown> };
      returning: () => Promise<unknown>;
    };
    valueChain.onConflictDoNothing = () => conflictChain;
    valueChain.onConflictDoUpdate = () => ({
      returning: () => Promise.resolve(result),
    });
    valueChain.returning = () => Promise.resolve(result);

    return valueChain;
  },
});

const createInsertBuilder = (result: unknown) => createTrackedInsertBuilder(result, true);

const DEFAULT_FEED_ROW = {
  id: "feed-default",
  isDefault: true,
  legacyAlias: false,
  name: "My Calendar",
  token: `feed_${"a".repeat(64)}`,
  userId: "user-1",
};

const FEED_BOOKKEEPING_ROWS: Record<string, unknown> = {
  ical_feed_calendars: [],
  ical_feeds: [DEFAULT_FEED_ROW],
};

const withFeedBookkeepingInserts = (
  insert: (table: unknown) => unknown,
) => (table: unknown): unknown => {
  const tableName = getTableName(table as never);
  if (tableName in FEED_BOOKKEEPING_ROWS) {
    return createTrackedInsertBuilder(FEED_BOOKKEEPING_ROWS[tableName], false);
  }
  return insert(table);
};

const createTxInstance = (): object => ({
  execute: () => Promise.resolve(),
  insert: withFeedBookkeepingInserts(() => createInsertBuilder([])),
  select: () => createSelectBuilder(selectResults.shift() ?? []),
  selectDistinct: () => ({
    from: () => ({}),
  }),
});

beforeAll(async () => {
  vi.mock("../../src/env", () => ({
    default: {},
    schema: {},
  }));

  vi.mock("../../src/context", () => ({
    baseUrl: "https://keeper.test",
    database: {
      insert: () => {
        throw new Error("global database.insert should not be used");
      },
      select: () => {
        throw new Error("global database.select should not be used");
      },
      selectDistinct: () => ({
        from: () => ({}),
      }),
      transaction: (callback: (tx: object) => Promise<unknown>) => callback(txInstance),
    },
    encryptionKey: "encryption-key",
    premiumService: {
      canAddAccount: () => Promise.resolve(canAddAccountResult),
      getUserPlan: () => Promise.resolve("free"),
      getAccountLimit: () => {
        if (canAddAccountResult) {
          return Number.MAX_SAFE_INTEGER;
        }
        return 0;
      },
      getMappingLimit: () => {
        if (canAddAccountResult) {
          return Number.MAX_SAFE_INTEGER;
        }
        return 0;
      },
    },
  }));

  vi.mock("../../src/utils/background-task", () => ({
    spawnBackgroundJob: (jobName: string, fields: { userId: string }, _callback: () => Promise<void>) => {
      spawnedJobNames.push(jobName);
      triggerSyncCalls.push(fields.userId);
    },
  }));

  vi.mock("../../src/utils/enqueue-push-sync", () => ({
    enqueuePushSync: (userId: string) => {
      triggerSyncCalls.push(userId);
    },
  }));

  vi.mock("@keeper.sh/database", () => ({
    encryptPassword: () => "encrypted-password",
  }));

  vi.mock("@keeper.sh/calendar/caldav", () => ({
    createCalDAVClient: () => ({
      discoverCalendars: () => Promise.resolve([]),
      getResolvedAuthMethod: () => "basic",
    }),
    createCalDAVProvider: () => ({
      id: "icloud",
    }),
    createCalDAVSourceProvider: () => ({
      id: "icloud",
    }),
  }));

  vi.mock("@keeper.sh/calendar/google", () => ({
    createGoogleCalendarProvider: () => ({
      id: "google",
    }),
    createGoogleCalendarSourceProvider: () => ({
      id: "google",
    }),
    listUserCalendars: () => Promise.resolve(googleCalendars),
  }));

  vi.mock("@keeper.sh/calendar/outlook", () => ({
    createOutlookCalendarProvider: () => ({
      id: "outlook",
    }),
    createOutlookSourceProvider: () => ({
      id: "outlook",
    }),
    listUserCalendars: () => Promise.resolve([]),
  }));

  vi.mock("@keeper.sh/calendar", () => ({
    PROVIDER_DEFINITIONS: [],
    getActiveProviders: () => [],
    getCalDAVProviders: () => [],
    getOAuthProviders: () => [],
    getProvider: () => globalThis.undefined,
    getProvidersByAuthType: () => [],
    isCalDAVProvider: () => true,
    isOAuthProvider: () => false,
    isProviderId: () => false,
  }));

  ({
    createOAuthSource,
    importOAuthAccountCalendars,
  } = await import("../../src/utils/oauth-sources"));
  ({
    createCalDAVSource,
  } = await import("../../src/utils/caldav-sources"));
}, COLD_IMPORT_TIMEOUT_MS);

afterAll(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  canAddAccountResult = true;
  googleCalendars = [{ id: "external-1", summary: "Team Calendar" }];
  insertCalls = [];
  selectResults = [];
  triggerSyncCalls = [];
  spawnedJobNames = [];
  txInstance = createTxInstance();
});

describe("Account locks", () => {
  it("creates OAuth sources without escaping the locked transaction", async () => {
    selectResults = [
      [{ email: "person@example.com" }],
      [],
      [],
      [],
    ];

    let insertStep = 0;
    txInstance = {
      execute: () => Promise.resolve(),
      insert: withFeedBookkeepingInserts(() => {
        insertStep += 1;
        if (insertStep === 1) {
          return createInsertBuilder([{ id: "account-1" }]);
        }

        return createInsertBuilder([{ id: "source-1", name: "Team Calendar" }]);
      }),
      select: () => createSelectBuilder(selectResults.shift() ?? []),
      selectDistinct: () => ({
        from: () => ({}),
      }),
    };

    const source = await createOAuthSource({
      externalCalendarId: "external-1",
      name: "Team Calendar",
      oauthCredentialId: "credential-1",
      provider: "google",
      userId: "user-1",
    });

    expect(source).toEqual({
      email: "person@example.com",
      id: "source-1",
      name: "Team Calendar",
      provider: "google",
    });
    expect(insertCalls).toHaveLength(2);
    expect(triggerSyncCalls).toEqual(["user-1", "user-1"]);
    expect(spawnedJobNames).toEqual([
      "oauth-source-push-enqueue",
      "oauth-source-push-register",
    ]);
  });

  it("imports OAuth calendars without escaping the locked transaction", async () => {
    selectResults = [
      [],
      [],
      [],
    ];

    let insertStep = 0;
    txInstance = {
      execute: () => Promise.resolve(),
      insert: withFeedBookkeepingInserts(() => {
        insertStep += 1;
        if (insertStep === 1) {
          return createInsertBuilder([{ id: "account-1" }]);
        }

        return createInsertBuilder([]);
      }),
      select: () => createSelectBuilder(selectResults.shift() ?? []),
      selectDistinct: () => ({
        from: () => ({}),
      }),
    };

    const accountId = await importOAuthAccountCalendars({
      accessToken: "access-token",
      email: "person@example.com",
      oauthCredentialId: "credential-1",
      provider: "google",
      providerAccountId: "google-account-1",
      userId: "user-1",
    });

    expect(accountId).toBe("account-1");
    expect(insertCalls).toHaveLength(2);
    expect(triggerSyncCalls).toEqual(["user-1", "user-1"]);
    expect(spawnedJobNames).toEqual([
      "oauth-account-import-push-enqueue",
      "oauth-account-import-push-register",
    ]);
  });

  it("creates CalDAV sources through the locked transaction client", async () => {
    selectResults = [
      [],
      [],
      [],
    ];

    let insertStep = 0;
    txInstance = {
      execute: () => Promise.resolve(),
      insert: withFeedBookkeepingInserts(() => {
        insertStep += 1;
        if (insertStep === 1) {
          return createInsertBuilder([{ id: "credential-1" }]);
        }
        if (insertStep === 2) {
          return createInsertBuilder([{ id: "account-1" }]);
        }

        return createInsertBuilder([{
          createdAt: new Date("2026-03-10T12:00:00.000Z"),
          id: "source-1",
          name: "Team CalDAV",
          userId: "user-1",
        }]);
      }),
      select: () => createSelectBuilder(selectResults.shift() ?? []),
      selectDistinct: () => ({
        from: () => ({}),
      }),
    };

    const source = await createCalDAVSource("user-1", {
      authMethod: "basic",
      calendarUrl: "https://caldav.test/team",
      name: "Team CalDAV",
      password: "secret",
      provider: "icloud",
      serverUrl: "https://caldav.test",
      username: "person@example.com",
    });

    expect(source).toMatchObject({
      accountId: "account-1",
      calendarUrl: "https://caldav.test/team",
      id: "source-1",
      name: "Team CalDAV",
      provider: "icloud",
      userId: "user-1",
    });
    expect(triggerSyncCalls).toEqual(["user-1"]);
  });
});
