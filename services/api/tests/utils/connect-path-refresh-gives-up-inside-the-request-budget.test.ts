import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { TOKEN_REFRESH_BUFFER_MS } from "@keeper.sh/constants";
import { runWithCredentialRefreshLock as realRunWithCredentialRefreshLock }
  from "../../../../packages/calendar/src/core/oauth/refresh-coordinator";
import type { createOAuthSource as createOAuthSourceFn } from "../../src/utils/oauth-sources";

let createOAuthSource: typeof createOAuthSourceFn = () =>
  Promise.reject(new Error("Module not loaded"));
let connectRefreshAcquireBudgetMs = Number.NaN;

interface RecordedInsert {
  table: string;
  values: Record<string, unknown>;
}

let recordedInserts: RecordedInsert[] = [];
let recordedWideFields: Record<string, unknown> = {};
let refreshedWithTokens: string[] = [];
let lockAcquireAttempts: string[] = [];
let txInstance: object = {};

const CONNECT_ACCESS_TOKEN = "connect-snapshot-access-token";
const CONNECT_REFRESH_TOKEN = "connect-snapshot-refresh-token";
const NOTHING_ADOPTABLE_REMAINING_MS = Math.floor(TOKEN_REFRESH_BUFFER_MS / 2);
const CONNECT_WALL_TIME_CEILING_MS = 10_000;
const CASE_TIMEOUT_MS = 60_000;
const MS_PER_SECOND = 1000;

const storedCredentialRow = () => ({
  accessToken: CONNECT_ACCESS_TOKEN,
  email: "person@example.com",
  expiresAt: new Date(Date.now() - MS_PER_SECOND),
  refreshToken: CONNECT_REFRESH_TOKEN,
});

const staleCredentialRow = () => ({
  accessToken: CONNECT_ACCESS_TOKEN,
  expiresAt: new Date(Date.now() + NOTHING_ADOPTABLE_REMAINING_MS),
});

const rowsForSelectedFields = (fields: unknown): unknown[] => {
  const keys = Object.keys((fields ?? {}) as Record<string, unknown>);

  if (keys.includes("refreshToken")) {
    return [storedCredentialRow()];
  }

  if (keys.includes("accessToken")) {
    return [staleCredentialRow()];
  }

  return [];
};

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

const selectByFields = (fields: unknown) => createSelectBuilder(rowsForSelectedFields(fields));

const createInsertBuilder = (table: unknown, result: unknown) => ({
  values: (values: Record<string, unknown>) => {
    recordedInserts.push({ table: getTableName(table as never), values });

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
    return createInsertBuilder(table, [{ id: "account-1" }]);
  }

  if (tableName === "ical_feeds") {
    return createInsertBuilder(table, [DEFAULT_FEED_ROW]);
  }

  if (tableName === "ical_feed_calendars") {
    return createInsertBuilder(table, []);
  }

  return createInsertBuilder(table, [{ id: "source-1", name: "Team Calendar" }]);
};

const updateForTable = () => ({
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
  select: selectByFields,
  selectDistinct: () => ({
    from: () => ({}),
  }),
  update: updateForTable,
});

vi.mock("../../src/env", () => ({
  default: {},
  schema: {},
}));

vi.mock("@/utils/logging", () => ({
  widelog: {
    error: () => null,
    errorFields: () => null,
    set: (key: string, value: unknown) => {
      recordedWideFields[key] = value;
    },
  },
}));

vi.mock("../../src/context", () => ({
  baseUrl: "https://keeper.test",
  database: {
    insert: insertForTable,
    select: selectByFields,
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
      fetchUserInfo: () =>
        Promise.reject(new Error("no access token should reach the provider")),
      getAuthorizationUrl: () => Promise.reject(new Error("not used")),
      hasRequiredScopes: () => true,
      refreshAccessToken: (refreshToken: string) => {
        refreshedWithTokens.push(refreshToken);
        return Promise.resolve({
          access_token: "connect-path-rotated-access-token",
          expires_in: 3600,
          refresh_token: "connect-path-rotated-refresh-token",
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
  refreshLockStore: {
    release: () => Promise.resolve(),
    tryAcquire: (key: string) => {
      lockAcquireAttempts.push(key);
      return Promise.resolve(false);
    },
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
  runWithCredentialRefreshLock: realRunWithCredentialRefreshLock,
}));

beforeAll(async () => {
  const {
    CONNECT_REFRESH_ACQUIRE_BUDGET_MS: budgetMs,
    createOAuthSource: createOAuthSourceImplementation,
  } = await import("../../src/utils/oauth-sources");

  createOAuthSource = createOAuthSourceImplementation;
  connectRefreshAcquireBudgetMs = budgetMs;
});

afterAll(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  recordedInserts = [];
  recordedWideFields = {};
  refreshedWithTokens = [];
  lockAcquireAttempts = [];
  txInstance = createTxInstance();
});

const connect = () =>
  createOAuthSource({
    externalCalendarId: "primary",
    name: "Work",
    oauthCredentialId: `credential-${crypto.randomUUID()}`,
    provider: "outlook",
    userId: "user-1",
  });

describe("Connect path refresh gives up inside the request budget", () => {
  it("creates the source without a fabricated account id while the lock stays held", async () => {
    const startedAt = Date.now();

    const source = await connect();

    expect(Date.now() - startedAt).toBeLessThan(CONNECT_WALL_TIME_CEILING_MS);
    expect(source).toBeTruthy();
    expect(lockAcquireAttempts.length).toBeGreaterThan(0);
    expect(refreshedWithTokens).toEqual([]);
    expect(recordedWideFields["oauth_source.provider_account_id_resolution"])
      .toBe("provider_failure");

    const accountInserts = recordedInserts.filter(
      (insert) => insert.table === "calendar_accounts",
    );

    expect(accountInserts).toHaveLength(1);
    expect(accountInserts[0]?.values.accountId ?? null).toBeNull();
  }, CASE_TIMEOUT_MS);

  it("keeps the connect budget below the server idle timeout", async () => {
    const constants = await import("@keeper.sh/constants");

    expect(Number.isNaN(connectRefreshAcquireBudgetMs)).toBe(false);
    expect(typeof constants.SERVER_IDLE_TIMEOUT_SECONDS).toBe("number");
    expect(connectRefreshAcquireBudgetMs)
      .toBeLessThan(constants.SERVER_IDLE_TIMEOUT_SECONDS * MS_PER_SECOND);
  });
});
