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

const SNAPSHOT_REFRESH_TOKEN = "refresh-token-v1";
const PEER_ROTATED_REFRESH_TOKEN = "refresh-token-v2";
const CONNECT_ROTATED_REFRESH_TOKEN = "refresh-token-v3";
const CONNECT_ROTATED_ACCESS_TOKEN = "connect-rotated-access-token";

let recordedUpdates: RecordedWrite[] = [];
let recordedInserts: RecordedWrite[] = [];
let presentedRefreshTokens: string[] = [];
let userInfoTokens: string[] = [];
let txInstance: object = {};

const refreshGoogleToken = createGoogleTokenRefresher({
  clientId: "client-id",
  clientSecret: "client-secret",
});

const snapshotCredentialRow = () => ({
  accessToken: "snapshot-access-token",
  email: "person@example.com",
  expiresAt: new Date(Date.now() + 30_000),
  needsReauthentication: false,
  provider: "google",
  refreshToken: SNAPSHOT_REFRESH_TOKEN,
});

const storedCredentialRow = () => ({
  accessToken: "snapshot-access-token",
  expiresAt: new Date(Date.now() + 30_000),
  refreshToken: PEER_ROTATED_REFRESH_TOKEN,
});

const rowsForSelectedFields = (fields: unknown): unknown[] => {
  const keys = new Set(Object.keys((fields ?? {}) as Record<string, unknown>));

  if (keys.has("refreshToken") && keys.has("email")) {
    return [snapshotCredentialRow()];
  }

  if (keys.has("refreshToken")) {
    return [storedCredentialRow()];
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

vi.mock("widelogger", () => ({
  widelog: {
    error: () => null,
    errorFields: () => null,
    flush: () => null,
    set: () => null,
    setFields: () => null,
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
      fetchUserInfo: (accessToken: string) => {
        userInfoTokens.push(accessToken);
        return Promise.resolve({ email: "person@example.com", id: "google-sub-1" });
      },
      getAuthorizationUrl: () => Promise.reject(new Error("not used")),
      hasRequiredScopes: () => true,
      refreshAccessToken: (refreshToken: string) => refreshGoogleToken(refreshToken),
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

const presentedRefreshTokenOf = (init: RequestInit | undefined): string => {
  const body = init?.body;

  if (!(body instanceof URLSearchParams)) {
    throw new TypeError("Google token refresh must post a form encoded body");
  }

  const refreshToken = body.get("refresh_token");

  if (typeof refreshToken !== "string") {
    throw new TypeError("Google token refresh must post a refresh_token");
  }

  return refreshToken;
};

beforeEach(() => {
  recordedUpdates = [];
  recordedInserts = [];
  presentedRefreshTokens = [];
  userInfoTokens = [];
  txInstance = createTxInstance();

  vi.stubGlobal("fetch", (_url: string, init?: RequestInit) => {
    const refreshToken = presentedRefreshTokenOf(init);
    presentedRefreshTokens.push(refreshToken);

    if (refreshToken !== PEER_ROTATED_REFRESH_TOKEN) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            error: "invalid_grant",
            error_description: "Token has been expired or revoked.",
          }),
          { status: 400 },
        ),
      );
    }

    return Promise.resolve(
      new Response(
        JSON.stringify({
          access_token: CONNECT_ROTATED_ACCESS_TOKEN,
          expires_in: 3600,
          refresh_token: CONNECT_ROTATED_REFRESH_TOKEN,
          token_type: "Bearer",
        }),
        { headers: { "Content-Type": "application/json" }, status: 200 },
      ),
    );
  });
});

const connect = () =>
  createOAuthSource({
    externalCalendarId: "primary",
    name: "Work",
    oauthCredentialId: "credential-1",
    provider: "google",
    userId: "user-1",
  });

describe("Connect refresh presents the refresh token read under the lock", () => {
  it("refreshes with the peer rotated refresh token instead of the outer snapshot one", async () => {
    const source = await connect();

    expect(source.id).toBe("source-1");
    expect(presentedRefreshTokens).not.toContain(SNAPSHOT_REFRESH_TOKEN);
    expect(presentedRefreshTokens).toEqual([PEER_ROTATED_REFRESH_TOKEN]);
    expect(userInfoTokens).toEqual([CONNECT_ROTATED_ACCESS_TOKEN]);
  });

  it("raises no reauthentication demand for the healthy account", async () => {
    await connect();

    const accountUpdates = recordedUpdates.filter(
      (write) => write.table === "calendar_accounts",
    );

    expect(accountUpdates.map((write) => write.values)).not.toContainEqual(
      expect.objectContaining({ needsReauthentication: true }),
    );
  });
});
