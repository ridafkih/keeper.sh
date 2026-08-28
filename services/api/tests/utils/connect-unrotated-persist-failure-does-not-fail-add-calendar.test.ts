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
let widelogFields: Array<[string, unknown]> = [];
let credentialUpdateFailures: unknown[] = [];
let selectResults: unknown[][] = [];
let txInstance: object = {};

const connectionTerminatedError = () =>
  Object.assign(new Error("connection terminated unexpectedly"), {
    code: "ERR_POSTGRES_EXPECTED_REQUEST",
  });

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
    const tableName = getTableName(table as never);
    recordedUpdates.push({ table: tableName, values });

    const failure = tableName === "oauth_credentials"
      ? credentialUpdateFailures.shift() ?? null
      : null;

    const chain = Promise.resolve() as Promise<void> & {
      where: () => Promise<void>;
    };
    chain.where = () => (failure === null ? Promise.resolve() : Promise.reject(failure));

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
  transaction: (callback: (savepoint: object) => Promise<unknown>) => callback(createTxInstance()),
});

beforeAll(async () => {
  vi.mock("../../src/env", () => ({
    default: {},
    schema: {},
  }));

  vi.mock("../../src/utils/logging", () => ({
    context: () => {},
    destroy: () => {},
    widelog: {
      error: () => {},
      errorFields: () => {},
      set: (field: string, value: unknown) => {
        widelogFields.push([field, value]);
      },
    },
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
        fetchUserInfo: () => Promise.resolve({ email: "person@example.com", id: "outlook-sub-x" }),
        getAuthorizationUrl: () => Promise.reject(new Error("not used")),
        hasRequiredScopes: () => true,
        refreshAccessToken: (refreshToken: string) => {
          refreshCalls.push(refreshToken);
          return Promise.resolve({
            access_token: "fresh-access-token",
            expires_in: 3600,
            refresh_token: "stored-refresh-token",
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

  vi.mock("@keeper.sh/database", async () => {
    const actual = await vi.importActual<Record<string, unknown>>("@keeper.sh/database");

    return {
      ...actual,
      encryptPassword: () => "encrypted-password",
    };
  });

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
    runWithCredentialRefreshLock: (
      _oauthCredentialId: string,
      runRefresh: () => Promise<unknown>,
    ) => runRefresh(),
  }));

  ({ createOAuthSource } = await import("../../src/utils/oauth-sources"));
});

afterAll(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  recordedUpdates = [];
  refreshCalls = [];
  widelogFields = [];
  credentialUpdateFailures = [];
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

const credentialUpdates = () =>
  recordedUpdates.filter((update) => update.table === "oauth_credentials");

describe("Connect survives a persist failure that lost nothing", () => {
  it("creates the source when every credential write fails but nothing was rotated", async () => {
    selectResults = [[nearlyExpiredCredentialRow()], [], [], []];
    credentialUpdateFailures = [
      connectionTerminatedError(),
      connectionTerminatedError(),
      connectionTerminatedError(),
    ];

    const source = await connect();

    expect(refreshCalls).toEqual(["stored-refresh-token"]);
    expect(credentialUpdates()).toHaveLength(3);
    expect(widelogFields).toContainEqual(["token.rotation_lost", false]);
    expect(source?.id).toBe("source-1");
  });
});
