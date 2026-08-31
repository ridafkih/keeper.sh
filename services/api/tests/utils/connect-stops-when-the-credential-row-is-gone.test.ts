import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import type { createOAuthSource as createOAuthSourceFn } from "../../src/utils/oauth-sources";

let createOAuthSource: typeof createOAuthSourceFn = () =>
  Promise.reject(new Error("Module not loaded"));

let insertedTables: string[] = [];
let refreshCalls: string[] = [];
let widelogFields: Array<[string, unknown]> = [];
let widelogErrorFields: Array<{ error: unknown; fields: Record<string, unknown> }> = [];
let credentialUpdateFailure: (() => Error) | null = null;
let selectResults: unknown[][] = [];
let rotatedRefreshToken: string | null = null;
let fetchUserInfo = vi.fn();
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
  insertedTables.push(tableName);

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

const connectionTerminatedError = () =>
  Object.assign(new Error("connection terminated unexpectedly"), {
    code: "ERR_POSTGRES_EXPECTED_REQUEST",
  });

const updateForTable = (table: unknown) => ({
  set: () => {
    const tableName = getTableName(table as never);
    const outcome = tableName === "oauth_credentials" ? { count: 0 } : { count: 1 };

    const failure = tableName === "oauth_credentials" ? credentialUpdateFailure : null;

    const settle = () => failure === null ? Promise.resolve(outcome) : Promise.reject(failure());

    const chain = Promise.resolve(outcome) as Promise<unknown> & {
      where: () => Promise<unknown>;
    };
    chain.where = settle;

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
      errorFields: (error: unknown, fields: Record<string, unknown>) => {
        widelogErrorFields.push({ error, fields });
      },
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
        fetchUserInfo: (...args: unknown[]) => fetchUserInfo(...args),
        getAuthorizationUrl: () => Promise.reject(new Error("not used")),
        hasRequiredScopes: () => true,
        refreshAccessToken: (refreshToken: string) => {
          refreshCalls.push(refreshToken);
          return Promise.resolve({
            access_token: "fresh",
            expires_in: 3600,
            ...(rotatedRefreshToken === null ? {} : { refresh_token: rotatedRefreshToken }),
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

const nearlyExpiredCredentialRow = () => ({
  accessToken: "stale-access-token",
  email: "person@example.com",
  expiresAt: new Date(Date.now() + 30_000),
  needsReauthentication: false,
  provider: "outlook",
  refreshToken: "stored-refresh-token",
});

beforeEach(() => {
  insertedTables = [];
  refreshCalls = [];
  widelogFields = [];
  widelogErrorFields = [];
  credentialUpdateFailure = null;
  selectResults = [[nearlyExpiredCredentialRow()], [], [], []];
  rotatedRefreshToken = null;
  fetchUserInfo = vi.fn(() =>
    Promise.resolve({ email: "person@example.com", id: "outlook-sub-x" })
  );
  txInstance = createTxInstance();
});

const connect = () =>
  createOAuthSource({
    externalCalendarId: "primary",
    name: "Work",
    oauthCredentialId: "credential-1",
    provider: "outlook",
    userId: "user-1",
  });

describe("Connect stops when the OAuth credential row is gone", () => {
  it("aborts the connect when the credential row vanished and nothing was rotated", async () => {
    await expect(connect()).rejects.toMatchObject({
      message: expect.stringMatching(/no longer exists; its update matched no row/),
      name: "CredentialRowMissingError",
    });

    expect(refreshCalls).toEqual(["stored-refresh-token"]);
    expect(fetchUserInfo).toHaveBeenCalledTimes(0);
    expect(insertedTables).toEqual([]);
  });

  it("still aborts the connect when the vanished row also lost a rotated refresh token", async () => {
    rotatedRefreshToken = "rotated-refresh-token";

    await expect(connect()).rejects.toMatchObject({
      name: "RotatedTokenNotPersistedError",
    });

    expect(widelogFields).toContainEqual(["token.rotation_lost", true]);
    expect(fetchUserInfo).toHaveBeenCalledTimes(0);
    expect(insertedTables).toEqual([]);
  });

  it("labels the vanished row permanent rather than a retriable rotation loss", async () => {
    await expect(connect()).rejects.toMatchObject({ name: "CredentialRowMissingError" });

    const missingRowCalls = widelogErrorFields.filter(
      (call) => (call.error as Error).name === "CredentialRowMissingError",
    );

    expect(missingRowCalls).toHaveLength(1);
    expect(missingRowCalls[0]?.fields).toEqual({
      retriable: false,
      slug: "connect-credential-row-missing",
    });
    expect(
      missingRowCalls.filter((call) => call.fields.retriable === true),
    ).toEqual([]);
    expect(widelogFields).not.toContainEqual(["token.rotation_lost", false]);
  });

  it("keeps the transient persist failure labelled retriable", async () => {
    credentialUpdateFailure = connectionTerminatedError;

    const source = await connect();

    expect(source?.id).toBe("source-1");
    expect(widelogErrorFields).toHaveLength(1);
    expect(widelogErrorFields[0]?.fields).toEqual({
      retriable: true,
      slug: "connect-refreshed-credential-not-persisted",
    });
    expect(widelogFields).toContainEqual(["token.rotation_lost", false]);
  });
});
