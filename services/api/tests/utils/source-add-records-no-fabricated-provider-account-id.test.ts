import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import type { createOAuthSource as createOAuthSourceFn } from "../../src/utils/oauth-sources";

let createOAuthSource: typeof createOAuthSourceFn = () =>
  Promise.reject(new Error("Module not loaded"));

let calendarAccountInserts: Record<string, unknown>[] = [];
let calendarAccountUpdates: Record<string, unknown>[] = [];
let selectResults: unknown[][] = [];
let txInstance: object = {};
let fetchUserInfoCalls: string[] = [];
let providerAccountId = "google-sub-x";

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
    return createInsertBuilder([{ id: "account-1" }], (values) => {
      calendarAccountInserts.push(values as Record<string, unknown>);
    });
  }

  if (tableName === "ical_feeds") {
    return createInsertBuilder([DEFAULT_FEED_ROW], () => {});
  }

  if (tableName === "ical_feed_calendars") {
    return createInsertBuilder([], () => {});
  }

  return createInsertBuilder([{ id: "source-1", name: "Team Calendar" }], () => {});
};

const createUpdateBuilder = (table: unknown) => ({
  set: (values: unknown) => {
    if (getTableName(table as never) === "calendar_accounts") {
      calendarAccountUpdates.push(values as Record<string, unknown>);
    }

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
  update: createUpdateBuilder,
  select: () => createSelectBuilder(selectResults.shift() ?? []),
  selectDistinct: () => ({
    from: () => ({}),
  }),
  transaction: (callback: (savepoint: object) => Promise<unknown>) => callback(createTxInstance()),
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
    oauthProviders: {
      getProvider: (providerId: string) => ({
        exchangeCodeForTokens: () => Promise.reject(new Error("not used")),
        fetchUserInfo: (accessToken: string) => {
          fetchUserInfoCalls.push(accessToken);
          return Promise.resolve({ email: `${providerId}@example.com`, id: providerAccountId });
        },
        getAuthorizationUrl: () => Promise.reject(new Error("not used")),
        hasRequiredScopes: () => true,
        refreshAccessToken: () => Promise.reject(new Error("token refresh should not be needed")),
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
  calendarAccountInserts = [];
  calendarAccountUpdates = [];
  selectResults = [];
  fetchUserInfoCalls = [];
  providerAccountId = "google-sub-x";
  txInstance = createTxInstance();
});

const CREDENTIAL_ROW = {
  accessToken: "access-token-1",
  email: "person@example.com",
  expiresAt: new Date(Date.now() + 3_600_000),
  needsReauthentication: false,
  provider: "google",
  refreshToken: "refresh-token-1",
};

describe("Source add records no fabricated provider account id", () => {
  it("records the provider's own account id on the calendar account row", async () => {
    selectResults = [[CREDENTIAL_ROW], [], [], []];

    await createOAuthSource({
      externalCalendarId: "primary",
      name: "Work",
      oauthCredentialId: "credential-1",
      provider: "google",
      userId: "user-1",
    });

    expect(calendarAccountInserts).toHaveLength(1);

    const [accountRow] = calendarAccountInserts;

    expect(accountRow?.accountId).toBe("google-sub-x");
    expect(fetchUserInfoCalls).toEqual(["access-token-1"]);
  });

  it("does not reuse the row id as a stand-in provider account id", async () => {
    selectResults = [[CREDENTIAL_ROW], [], [], []];

    await createOAuthSource({
      externalCalendarId: "primary",
      name: "Work",
      oauthCredentialId: "credential-1",
      provider: "google",
      userId: "user-1",
    });

    const [accountRow] = calendarAccountInserts;

    expect(accountRow?.accountId).not.toBe(accountRow?.id);
    expect(accountRow?.accountId).not.toBe("credential-1");
  });

  it("adopts the provider account id onto a reused calendar row", async () => {
    selectResults = [[CREDENTIAL_ROW], [], [{ id: "account-legacy" }], []];

    await createOAuthSource({
      externalCalendarId: "secondary",
      name: "Work",
      oauthCredentialId: "credential-1",
      provider: "google",
      userId: "user-1",
    });

    expect(fetchUserInfoCalls).toEqual(["access-token-1"]);
    expect(calendarAccountInserts).toEqual([]);
    expect(calendarAccountUpdates).toEqual([{ accountId: "google-sub-x" }]);
  });
});
