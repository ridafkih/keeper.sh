import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import type { createOAuthSource as createOAuthSourceFn } from "../../src/utils/oauth-sources";

let createOAuthSource: typeof createOAuthSourceFn = () =>
  Promise.reject(new Error("Module not loaded"));

let calendarAccountInserts: Record<string, unknown>[] = [];
let calendarSourceInserts: Record<string, unknown>[] = [];
let selectResults: unknown[][] = [];
let txInstance: object = {};
let transactionOpen = false;
let transactionOpenDuringUserInfo: boolean | null = null;
let userInfoEntered: () => void = () => {};
let userInfoEnteredPromise: Promise<void> = Promise.resolve();
let releaseUserInfo: () => void = () => {};
let userInfoGate: Promise<void> = Promise.resolve();

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
      insert: insertForTable,
      select: () => createSelectBuilder(selectResults.shift() ?? []),
      selectDistinct: () => ({
        from: () => ({}),
      }),
      transaction: async (callback: (tx: object) => Promise<unknown>) => {
        transactionOpen = true;
        try {
          return await callback(txInstance);
        } finally {
          transactionOpen = false;
        }
      },
      update: createUpdateBuilder,
    },
    encryptionKey: "encryption-key",
    oauthProviders: {
      getProvider: () => ({
        exchangeCodeForTokens: () => Promise.reject(new Error("not used")),
        fetchUserInfo: async () => {
          transactionOpenDuringUserInfo = transactionOpen;
          userInfoEntered();
          await userInfoGate;
          return { email: "person@example.com", id: "google-sub-x" };
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
  calendarSourceInserts = [];
  selectResults = [];
  transactionOpen = false;
  transactionOpenDuringUserInfo = null;
  txInstance = createTxInstance();
  userInfoEnteredPromise = new Promise<void>((resolve) => {
    userInfoEntered = resolve;
  });
  userInfoGate = new Promise<void>((resolve) => {
    releaseUserInfo = resolve;
  });
});

const CREDENTIAL_ROW = {
  accessToken: "access-token-1",
  email: "person@example.com",
  expiresAt: new Date(Date.now() + 3_600_000),
  needsReauthentication: false,
  provider: "google",
  refreshToken: "refresh-token-1",
};

describe("The connect time userinfo call runs outside the database transaction", () => {
  it("holds no open transaction while the provider userinfo call is pending", async () => {
    selectResults = [[CREDENTIAL_ROW], [], [], []];

    const pending = createOAuthSource({
      externalCalendarId: "primary",
      name: "Work",
      oauthCredentialId: "credential-1",
      provider: "google",
      userId: "user-1",
    });

    await userInfoEnteredPromise;

    expect(transactionOpenDuringUserInfo).toBe(false);

    releaseUserInfo();
    await pending;
  });

  it("writes the same rows once the provider answers", async () => {
    selectResults = [[CREDENTIAL_ROW], [], [], []];

    const pending = createOAuthSource({
      externalCalendarId: "primary",
      name: "Work",
      oauthCredentialId: "credential-1",
      provider: "google",
      userId: "user-1",
    });

    await userInfoEnteredPromise;
    releaseUserInfo();
    await pending;

    expect(calendarAccountInserts).toHaveLength(1);
    expect(calendarAccountInserts[0]?.accountId).toBe("google-sub-x");
    expect(calendarAccountInserts[0]?.email).toBe("person@example.com");
    expect(calendarAccountInserts[0]?.provider).toBe("google");
    expect(calendarAccountInserts[0]?.oauthCredentialId).toBe("credential-1");
    expect(calendarSourceInserts).toHaveLength(1);
    expect(calendarSourceInserts[0]?.accountId).toBe("account-1");
    expect(calendarSourceInserts[0]?.externalCalendarId).toBe("primary");
    expect(calendarSourceInserts[0]?.calendarType).toBe("oauth");
  });
});
