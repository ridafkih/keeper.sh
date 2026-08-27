import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import type { createOAuthSource as createOAuthSourceFn } from "../../src/utils/oauth-sources";

let createOAuthSource: typeof createOAuthSourceFn = () =>
  Promise.reject(new Error("Module not loaded"));

interface RecordedUpdate {
  table: string;
  values: Record<string, unknown>;
}

let recordedUpdates: RecordedUpdate[] = [];
let refreshCalls: string[] = [];
let userInfoTokens: string[] = [];
let lockedCredentialIds: string[] = [];
let refreshRanUnderLock: boolean[] = [];
let lockDepth = 0;
let selectResults: unknown[][] = [];
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

const createInsertBuilder = (result: unknown) => ({
  values: () => {
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
    return createInsertBuilder([{ id: "account-1" }]);
  }

  if (tableName === "ical_feeds") {
    return createInsertBuilder([DEFAULT_FEED_ROW]);
  }

  if (tableName === "ical_feed_calendars") {
    return createInsertBuilder([]);
  }

  return createInsertBuilder([{ id: "source-1", name: "Team Calendar" }]);
};

const updateForTable = (table: unknown) => ({
  set: (values: Record<string, unknown>) => {
    recordedUpdates.push({ table: getTableName(table as never), values });

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
  update: updateForTable,
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
      insert: insertForTable,
      select: () => createSelectBuilder(selectResults.shift() ?? []),
      selectDistinct: () => ({
        from: () => ({}),
      }),
      transaction: (callback: (tx: object) => Promise<unknown>) => callback(txInstance),
      update: updateForTable,
    },
    encryptionKey: "encryption-key",
    oauthProviders: {
      getProvider: () => ({
        exchangeCodeForTokens: () => Promise.reject(new Error("not used")),
        fetchUserInfo: (accessToken: string) => {
          userInfoTokens.push(accessToken);
          return Promise.resolve({ email: "person@example.com", id: "google-sub-x" });
        },
        getAuthorizationUrl: () => Promise.reject(new Error("not used")),
        hasRequiredScopes: () => true,
        refreshAccessToken: (refreshToken: string) => {
          refreshCalls.push(refreshToken);
          refreshRanUnderLock.push(lockDepth > 0);
          return Promise.resolve({
            access_token: "fresh-access-token",
            expires_in: 3600,
            refresh_token: "rotated-refresh-token",
          });
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
    runWithCredentialRefreshLock: async (
      oauthCredentialId: string,
      runRefresh: () => Promise<unknown>,
    ) => {
      lockedCredentialIds.push(oauthCredentialId);
      lockDepth += 1;
      try {
        return await runRefresh();
      } finally {
        lockDepth -= 1;
      }
    },
  }));

  ({ createOAuthSource } = await import("../../src/utils/oauth-sources"));
});

afterAll(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  recordedUpdates = [];
  refreshCalls = [];
  userInfoTokens = [];
  lockedCredentialIds = [];
  refreshRanUnderLock = [];
  lockDepth = 0;
  selectResults = [];
  txInstance = createTxInstance();
});

const nearlyExpiredCredentialRow = () => ({
  accessToken: "stale-access-token",
  email: "person@example.com",
  expiresAt: new Date(Date.now() + 30_000),
  needsReauthentication: false,
  provider: "outlook",
  refreshToken: "stored-refresh-token",
});

const connect = () =>
  createOAuthSource({
    externalCalendarId: "primary",
    name: "Work",
    oauthCredentialId: "credential-1",
    provider: "outlook",
    userId: "user-1",
  });

describe("Connect time refresh persists the rotated credential under the refresh lock", () => {
  it("writes the rotated refresh token and the new expiry to oauth_credentials", async () => {
    selectResults = [[nearlyExpiredCredentialRow()], [], [], []];
    const before = Date.now();

    await connect();

    expect(refreshCalls).toEqual(["stored-refresh-token"]);
    expect(userInfoTokens).toEqual(["fresh-access-token"]);

    const credentialUpdates = recordedUpdates.filter(
      (update) => update.table === "oauth_credentials",
    );

    expect(credentialUpdates).toHaveLength(1);
    expect(credentialUpdates[0]?.values.accessToken).toBe("fresh-access-token");
    expect(credentialUpdates[0]?.values.refreshToken).toBe("rotated-refresh-token");

    const expiresAt = credentialUpdates[0]?.values.expiresAt as Date;
    expect(expiresAt).toBeInstanceOf(Date);
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + 3_600_000 - 5000);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 3_600_000 + 5000);
  });

  it("runs the connect time refresh inside the credential refresh lock", async () => {
    selectResults = [[nearlyExpiredCredentialRow()], [], [], []];

    await connect();

    expect(lockedCredentialIds).toEqual(["credential-1"]);
    expect(refreshRanUnderLock).toEqual([true]);
  });
});
