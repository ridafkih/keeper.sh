import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { fetchUserInfo as fetchGoogleUserInfo } from "../../../../packages/calendar/src/core/oauth/google";
import type { createOAuthSource as createOAuthSourceFn } from "../../src/utils/oauth-sources";

let createOAuthSource: typeof createOAuthSourceFn = () =>
  Promise.reject(new Error("Module not loaded"));

let calendarAccountInserts: Record<string, unknown>[] = [];
let calendarAccountUpdates: Record<string, unknown>[] = [];
let calendarSourceInserts: Record<string, unknown>[] = [];
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
      insert: insertForTable,
      select: () => createSelectBuilder(selectResults.shift() ?? []),
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
        fetchUserInfo: (accessToken: string, options?: { signal?: AbortSignal }) =>
          fetchGoogleUserInfo(accessToken, options?.signal),
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
  calendarSourceInserts = [];
  selectResults = [];
  txInstance = createTxInstance();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const CREDENTIAL_ROW = {
  accessToken: "access-token-1",
  email: "person@example.com",
  expiresAt: new Date(Date.now() + 3_600_000),
  needsReauthentication: false,
  provider: "google",
  refreshToken: "refresh-token-1",
};

const UNAUTHENTICATED_BODY = JSON.stringify({
  error: {
    code: 401,
    message: "Request had invalid authentication credentials.",
    status: "UNAUTHENTICATED",
  },
});

const BACKEND_ERROR_BODY = JSON.stringify({
  error: {
    code: 503,
    message: "The service is currently unavailable.",
    status: "UNAVAILABLE",
  },
});

const stubUserInfoResponse = (status: number, body: string) => {
  vi.stubGlobal("fetch", () =>
    Promise.resolve(
      new Response(body, {
        headers: { "content-type": "application/json" },
        status,
      }),
    ),
  );
};

const connectGoogleSource = () =>
  createOAuthSource({
    externalCalendarId: "primary",
    name: "Work",
    oauthCredentialId: "credential-1",
    provider: "google",
    userId: "user-1",
  });

describe("Connect writes the revoked grant flag onto an existing calendar account", () => {
  it("updates the reused account row instead of only telling the caller", async () => {
    selectResults = [[CREDENTIAL_ROW], [], [{ id: "account-existing" }], []];
    stubUserInfoResponse(401, UNAUTHENTICATED_BODY);

    const source = await connectGoogleSource();

    expect(source.needsReauthentication).toBe(true);
    expect(calendarAccountInserts).toHaveLength(0);

    const reauthenticationUpdates = calendarAccountUpdates.filter(
      (update) => update.needsReauthentication === true,
    );

    expect(reauthenticationUpdates).toHaveLength(1);
    expect(reauthenticationUpdates[0]?.reauthenticationSource).not.toBeNull();
    expect(reauthenticationUpdates[0]?.reauthenticationSource).not.toBeUndefined();
  });

  it("leaves a reused account unflagged when userinfo answers 503", async () => {
    selectResults = [[CREDENTIAL_ROW], [], [{ id: "account-existing" }], []];
    stubUserInfoResponse(503, BACKEND_ERROR_BODY);

    const source = await connectGoogleSource();

    expect(source.needsReauthentication).toBe(false);
    expect(calendarAccountInserts).toHaveLength(0);
    expect(
      calendarAccountUpdates.filter((update) => update.needsReauthentication === true),
    ).toHaveLength(0);
  });
});
