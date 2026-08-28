import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { createGoogleTokenRefresher } from "../../../../packages/calendar/src/core/oauth/google";
import type { createOAuthSource as createOAuthSourceFn } from "../../src/utils/oauth-sources";

let createOAuthSource: typeof createOAuthSourceFn = () =>
  Promise.reject(new Error("Module not loaded"));

interface RecordedWrite {
  table: string;
  values: Record<string, unknown>;
}

let recordedUpdates: RecordedWrite[] = [];
let recordedInserts: RecordedWrite[] = [];
let telemetryFields: [string, unknown][] = [];
let refreshRejections: string[] = [];
let selectResults: unknown[][] = [];
let txInstance: object = {};

const refreshRevokedGrant = createGoogleTokenRefresher({
  clientId: "client-id",
  clientSecret: "client-secret",
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
  update: updateForTable,
  select: () => createSelectBuilder(selectResults.shift() ?? []),
  selectDistinct: () => ({
    from: () => ({}),
  }),
  transaction: (callback: (savepoint: object) => Promise<unknown>) => callback(createTxInstance()),
});

vi.mock("widelogger", () => ({
  widelog: {
    error: () => null,
    errorFields: () => null,
    flush: () => null,
    set: (key: string, value: unknown) => {
      telemetryFields.push([key, value]);
    },
    setFields: (fields: Record<string, unknown>) => {
      for (const entry of Object.entries(fields)) {
        telemetryFields.push(entry);
      }
    },
    time: { measure: (_key: string, callback: () => unknown) => callback() },
  },
  widelogger: () => ({
    context: (callback: () => unknown) => callback(),
    destroy: () => null,
  }),
}));

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
      fetchUserInfo: () =>
        Promise.reject(new Error("userinfo must not be reached on a revoked grant")),
      getAuthorizationUrl: () => Promise.reject(new Error("not used")),
      hasRequiredScopes: () => true,
      refreshAccessToken: (refreshToken: string) =>
        refreshRevokedGrant(refreshToken).catch((error: unknown) => {
          refreshRejections.push(error instanceof Error ? error.message : String(error));
          throw error;
        }),
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
  getDatabaseErrorDetails: () => null,
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
  runWithCredentialRefreshLock: (
    _oauthCredentialId: string,
    runRefresh: () => Promise<unknown>,
  ) => runRefresh(),
}));

beforeAll(async () => {
  ({ createOAuthSource } = await import("../../src/utils/oauth-sources"));
});

afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const revokedCredentialRow = () => ({
  accessToken: "stale-access-token",
  email: "person@example.com",
  expiresAt: new Date(Date.now() + 30_000),
  needsReauthentication: false,
  provider: "google",
  refreshToken: "revoked-refresh-token",
});

beforeEach(() => {
  recordedUpdates = [];
  recordedInserts = [];
  telemetryFields = [];
  refreshRejections = [];
  selectResults = [[revokedCredentialRow()], [], [], []];
  txInstance = createTxInstance();

  vi.stubGlobal("fetch", () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          error: "invalid_grant",
          error_description: "Token has been expired or revoked.",
        }),
        { status: 400 },
      ),
    ));
});

const connect = () =>
  createOAuthSource({
    externalCalendarId: "primary",
    name: "Work",
    oauthCredentialId: "credential-1",
    provider: "google",
    userId: "user-1",
  });

describe("Connect refresh raises needs reauthentication on a revoked grant", () => {
  it("flags the credential's calendar accounts when the connect time refresh is rejected", async () => {
    const source = await connect();

    expect(refreshRejections).toHaveLength(1);
    expect(refreshRejections[0]).toContain("invalid_grant");

    expect(source.id).toBe("source-1");

    const accountInserts = recordedInserts.filter(
      (write) => write.table === "calendar_accounts",
    );

    expect(accountInserts).toHaveLength(1);
    expect(accountInserts[0]?.values.accountId).toBeNull();

    const accountUpdates = recordedUpdates.filter(
      (write) => write.table === "calendar_accounts",
    );

    expect(accountUpdates.map((write) => write.values)).toContainEqual(
      expect.objectContaining({
        needsReauthentication: true,
        reauthenticationSource: "token-refresh",
      }),
    );
  });

  it("records the reauthentication demand telemetry for the rejected refresh", async () => {
    await connect();

    expect(telemetryFields).toContainEqual(["reauth.action", "raise"]);
    expect(telemetryFields).toContainEqual(["reauth.provenance", "token-refresh"]);
  });
});
