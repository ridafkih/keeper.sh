import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import type { createOAuthSource as createOAuthSourceFn } from "../../src/utils/oauth-sources";

let createOAuthSource: typeof createOAuthSourceFn = () =>
  Promise.reject(new Error("Module not loaded"));

let providerCalls: string[] = [];
let calendarAccountInserts: Record<string, unknown>[] = [];
let calendarSourceInserts: Record<string, unknown>[] = [];
let txInstance: object = {};

const CREDENTIAL_ROW = {
  accessToken: "access-token-1",
  email: "person@example.com",
  expiresAt: new Date(Date.now() + 3_600_000),
  needsReauthentication: false,
  provider: "google",
  refreshToken: "refresh-token-1",
};

const STORED_ACCOUNT_ROW = {
  accountId: "google-account-77",
  email: "person@example.com",
  id: "account-existing",
  oauthCredentialId: "credential-1",
  provider: "google",
  userId: "user-1",
};

type SelectPromise = Promise<unknown[]> & {
  from: (table: unknown) => SelectPromise;
  innerJoin: () => SelectPromise;
  leftJoin: () => SelectPromise;
  where: () => SelectPromise;
  limit: () => Promise<unknown[]>;
};

const rowsForTable = (table: unknown): unknown[] => {
  const tableName = getTableName(table as never);

  if (tableName === "oauth_credentials") {
    return [CREDENTIAL_ROW];
  }

  if (tableName === "calendar_accounts") {
    return [STORED_ACCOUNT_ROW];
  }

  return [];
};

const createSelectBuilder = (): SelectPromise => {
  let rows: unknown[] = [];
  const chain = new Promise<unknown[]>((resolve) => {
    queueMicrotask(() => resolve(rows));
  }) as SelectPromise;
  chain.from = (table: unknown) => {
    rows = rowsForTable(table);
    return chain;
  };
  chain.innerJoin = () => chain;
  chain.leftJoin = () => chain;
  chain.where = () => chain;
  chain.limit = () => Promise.resolve(rows);
  return chain;
};

const createInsertBuilder = (result: unknown, record: (values: unknown) => void) => ({
  values: (values: unknown) => {
    record(values);

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

const DEFAULT_FEED_ROW = {
  id: "feed-default",
  isDefault: true,
  legacyAlias: false,
  name: "My Calendar",
  token: `feed_${"a".repeat(64)}`,
  userId: "user-1",
};

const insertForTable = (table: unknown) => {
  const tableName = getTableName(table as never);

  if (tableName === "calendar_accounts") {
    return createInsertBuilder([{ id: "account-created" }], (values) => {
      calendarAccountInserts.push(values as Record<string, unknown>);
    });
  }

  if (tableName === "ical_feeds") {
    return createInsertBuilder([DEFAULT_FEED_ROW], () => {});
  }

  if (tableName === "ical_feed_calendars") {
    return createInsertBuilder([], () => {});
  }

  return createInsertBuilder([{ id: "source-1", name: "Team Calendar" }], (values) => {
    calendarSourceInserts.push(...(values as Record<string, unknown>[]));
  });
};

const createUpdateBuilder = () => ({
  set: () => {
    const chain = Promise.resolve() as Promise<void> & {
      where: () => Promise<void>;
    };
    chain.where = () => Promise.resolve();

    return chain;
  },
});

const createTxInstance = (): object => ({
  execute: () => Promise.resolve(),
  insert: insertForTable,
  select: createSelectBuilder,
  selectDistinct: () => ({
    from: () => ({}),
  }),
  update: createUpdateBuilder,
});

beforeAll(async () => {
  vi.mock("../../src/env", () => ({
    default: {},
    schema: {},
  }));

  vi.mock("../../src/context", () => ({
    baseUrl: "https://keeper.test",
    database: {
      insert: insertForTable,
      select: createSelectBuilder,
      selectDistinct: () => ({
        from: () => ({}),
      }),
      transaction: (callback: (tx: object) => Promise<unknown>) => callback(txInstance),
      update: createUpdateBuilder,
    },
    encryptionKey: "encryption-key",
    oauthProviders: {
      getProvider: () => ({
        exchangeCodeForTokens: () => Promise.reject(new Error("not used")),
        fetchUserInfo: () => {
          providerCalls.push("fetchUserInfo");
          return Promise.resolve({ email: "person@example.com", id: "google-account-77" });
        },
        getAuthorizationUrl: () => Promise.reject(new Error("not used")),
        hasRequiredScopes: () => true,
        refreshAccessToken: () => {
          providerCalls.push("refreshAccessToken");
          return Promise.resolve({ access_token: "access-token-2", expires_in: 3600 });
        },
      }),
      hasRequiredScopes: () => true,
      isOAuthProvider: () => true,
      validateState: () => Promise.resolve(null),
    },
    premiumService: {
      canAddAccount: () => Promise.resolve(true),
      getAccountLimit: () => Number.MAX_SAFE_INTEGER,
      getMappingLimit: () => Number.MAX_SAFE_INTEGER,
      getUserPlan: () => Promise.resolve("free"),
    },
  }));

  vi.mock("../../src/utils/background-task", () => ({
    spawnBackgroundJob: () => {},
  }));

  vi.mock("../../src/utils/enqueue-push-sync", () => ({
    enqueuePushSync: () => {},
  }));

  vi.mock("../../src/utils/push-notifications/register-account-channels", () => ({
    registerAccountPushChannels: () => Promise.resolve(),
  }));

  vi.mock("@keeper.sh/database", () => ({
    encryptPassword: () => "encrypted-password",
  }));

  vi.mock("@keeper.sh/calendar/google", () => ({
    createGoogleCalendarProvider: () => ({ id: "google" }),
    createGoogleCalendarSourceProvider: () => ({ id: "google" }),
    listUserCalendars: () => Promise.resolve([]),
  }));

  vi.mock("@keeper.sh/calendar/outlook", () => ({
    createOutlookCalendarProvider: () => ({ id: "outlook" }),
    createOutlookSourceProvider: () => ({ id: "outlook" }),
    listUserCalendars: () => Promise.resolve([]),
  }));

  vi.mock("@keeper.sh/calendar", () => ({
    PROVIDER_DEFINITIONS: [],
    getActiveProviders: () => [],
    getCalDAVProviders: () => [],
    getOAuthProviders: () => [],
    getProvider: () => globalThis.undefined,
    getProvidersByAuthType: () => [],
    isCalDAVProvider: () => false,
    isOAuthProvider: () => true,
    isProviderId: () => true,
  }));

  ({ createOAuthSource } = await import("../../src/utils/oauth-sources"));
});

afterAll(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  providerCalls = [];
  calendarAccountInserts = [];
  calendarSourceInserts = [];
  txInstance = createTxInstance();
});

describe("Connect source skips the provider call when the account identity is already stored", () => {
  it("creates the source without any provider round-trip", async () => {
    const source = await createOAuthSource({
      externalCalendarId: "primary",
      name: "Work",
      oauthCredentialId: "credential-1",
      provider: "google",
      userId: "user-1",
    });

    expect(providerCalls).toEqual([]);
    expect(source.id).toBe("source-1");
    expect(calendarSourceInserts).toHaveLength(1);
    expect(calendarAccountInserts).toHaveLength(0);
  });
});
