import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { TOKEN_REFRESH_BUFFER_MS } from "@keeper.sh/constants";
import { runWithCredentialRefreshLock as realRunWithCredentialRefreshLock }
  from "../../../../packages/calendar/src/core/oauth/refresh-coordinator";
import type { createOAuthSource as createOAuthSourceFn } from "../../src/utils/oauth-sources";
import type * as ConnectDeadlineModule from "../../src/utils/connect-deadline";

let createOAuthSource: typeof createOAuthSourceFn = () =>
  Promise.reject(new Error("Module not loaded"));

interface RecordedWrite {
  table: string;
  values: Record<string, unknown>;
}

type RefreshBehaviour = (
  refreshToken: string,
  options?: { signal?: AbortSignal },
) => Promise<never>;

let recordedInserts: RecordedWrite[] = [];
let recordedUpdates: RecordedWrite[] = [];
let recordedWideFields: Record<string, unknown> = {};
let presentedRefreshTokens: string[] = [];
let refreshRejections: string[] = [];
let refreshCallsThatSawNoSignal = 0;
let txInstance: object = {};
let refreshBehaviour: RefreshBehaviour = () =>
  Promise.reject(new Error("No refresh behaviour installed"));

const SHORT_CONNECT_CEILING_MS = 700;
const CASE_TIMEOUT_MS = 30_000;
const MS_PER_SECOND = 1000;
const PROVIDER_REQUEST_TIMEOUT_MS = 15_000;
const NOTHING_ADOPTABLE_REMAINING_MS = Math.floor(TOKEN_REFRESH_BUFFER_MS / 2);
const CONNECT_ACCESS_TOKEN = "connect-access-token";
const CONNECT_REFRESH_TOKEN = "connect-refresh-token";

const rejectsWithTheSignalReason: RefreshBehaviour = (_refreshToken, options) =>
  new Promise<never>((_resolve, reject) => {
    options?.signal?.addEventListener("abort", () => {
      reject(options.signal?.reason);
    });
  });

const rejectsWithTheProviderTimeoutWrapper: RefreshBehaviour = (_refreshToken, options) =>
  new Promise<never>((_resolve, reject) => {
    options?.signal?.addEventListener("abort", () => {
      reject(new Error(`Token refresh timed out after ${PROVIDER_REQUEST_TIMEOUT_MS}ms`));
    });
  });

const rejectsWithARefusedGrant: RefreshBehaviour = () =>
  Promise.reject(new Error("Token refresh failed (400): invalid_grant"));

const storedCredentialRow = () => ({
  accessToken: CONNECT_ACCESS_TOKEN,
  email: "person@example.com",
  expiresAt: new Date(Date.now() - MS_PER_SECOND),
  needsReauthentication: false,
  provider: "outlook",
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
  select: selectByFields,
  selectDistinct: () => ({
    from: () => ({}),
  }),
  transaction: (callback: (savepoint: object) => Promise<unknown>) => callback(createTxInstance()),
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

vi.mock("../../src/utils/connect-deadline", async (importOriginal) => {
  const actual = await importOriginal<typeof ConnectDeadlineModule>();

  return {
    ...actual,
    openConnectDeadline: () => actual.openConnectDeadline(SHORT_CONNECT_CEILING_MS),
  };
});

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
      fetchUserInfo: () => Promise.reject(new Error("userinfo must not be reached")),
      getAuthorizationUrl: () => Promise.reject(new Error("not used")),
      hasRequiredScopes: () => true,
      refreshAccessToken: async (
        refreshToken: string,
        options?: { signal?: AbortSignal },
      ) => {
        presentedRefreshTokens.push(refreshToken);

        if (!options?.signal) {
          refreshCallsThatSawNoSignal += 1;
        }

        try {
          return await refreshBehaviour(refreshToken, options);
        } catch (error) {
          refreshRejections.push((error as Error).name);
          throw error;
        }
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
    tryAcquire: () => Promise.resolve(true),
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
  const { createOAuthSource: implementation } = await import("../../src/utils/oauth-sources");

  createOAuthSource = implementation;
});

afterAll(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  recordedInserts = [];
  recordedUpdates = [];
  recordedWideFields = {};
  presentedRefreshTokens = [];
  refreshRejections = [];
  refreshCallsThatSawNoSignal = 0;
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

const credentialUpdates = () =>
  recordedUpdates.filter((update) => update.table === "oauth_credentials");

describe("Connect refresh cancellation records the rotation loss", () => {
  it("reports an unknown rotation loss when the connect deadline cancels the refresh", async () => {
    refreshBehaviour = rejectsWithTheSignalReason;

    const source = await connect();

    expect(presentedRefreshTokens).toEqual([CONNECT_REFRESH_TOKEN]);
    expect(refreshCallsThatSawNoSignal).toBe(0);
    expect(refreshRejections).toEqual(["TimeoutError"]);
    expect(credentialUpdates()).toEqual([]);
    expect(recordedWideFields["token.rotation_lost"]).toBe("unknown");
    expect(recordedWideFields["oauth_source.provider_account_id_resolution"])
      .toBe("provider_failure");
    expect(source.id).toBe("source-1");
  }, CASE_TIMEOUT_MS);

  it("reports the loss when the provider masks the cancellation as its own timeout", async () => {
    refreshBehaviour = rejectsWithTheProviderTimeoutWrapper;

    const source = await connect();

    expect(presentedRefreshTokens).toEqual([CONNECT_REFRESH_TOKEN]);
    expect(credentialUpdates()).toEqual([]);
    expect(recordedWideFields["token.rotation_lost"]).toBe("unknown");
    expect(recordedWideFields["oauth_source.provider_account_id_resolution"])
      .toBe("provider_failure");
    expect(source.id).toBe("source-1");
  }, CASE_TIMEOUT_MS);

  it("leaves a refused grant reported exactly as it is today", async () => {
    refreshBehaviour = rejectsWithARefusedGrant;

    const source = await connect();

    expect(presentedRefreshTokens).toEqual([CONNECT_REFRESH_TOKEN]);
    expect(credentialUpdates()).toEqual([]);
    expect(recordedWideFields["token.rotation_lost"]).toBeUndefined();
    expect(recordedWideFields["token.rotation_recovered"]).toBeUndefined();
    expect(recordedWideFields["oauth_source.provider_account_id_resolution"])
      .toBe("provider_failure");
    expect(source.id).toBe("source-1");
  }, CASE_TIMEOUT_MS);
});
