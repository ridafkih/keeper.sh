import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { createOAuthProviders } from "../../../../packages/calendar/src/core/oauth/providers";
import type { createOAuthSource as createOAuthSourceFn } from "../../src/utils/oauth-sources";

let createOAuthSource: typeof createOAuthSourceFn = () =>
  Promise.reject(new Error("Module not loaded"));

let calendarAccountInserts: Record<string, unknown>[] = [];
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

const createStateStore = () => ({
  consume: () => Promise.resolve(null),
  set: () => Promise.resolve(),
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
    oauthProviders: createOAuthProviders(
      {
        google: null,
        microsoft: { clientId: "microsoft-client", clientSecret: "microsoft-secret" },
      },
      createStateStore(),
    ),
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
  provider: "outlook",
  refreshToken: "refresh-token-1",
};

const INVALID_AUTHENTICATION_TOKEN_BODY = JSON.stringify({
  error: {
    code: "InvalidAuthenticationToken",
    innerError: {
      date: "2026-08-27T06:15:33",
      "request-id": "8f1f1e2c-0000-4a6b-9f2b-3f2f4a5b6c7d",
    },
    message: "Access token has been revoked.",
  },
});

const GRAPH_UNAVAILABLE_BODY = JSON.stringify({
  error: {
    code: "serviceNotAvailable",
    message: "Service is temporarily unavailable, please try again later.",
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

const connectOutlookSource = () =>
  createOAuthSource({
    externalCalendarId: "primary",
    name: "Work",
    oauthCredentialId: "credential-1",
    provider: "outlook",
    userId: "user-1",
  });

describe("Connect flags a revoked outlook grant when the graph userinfo probe answers 401", () => {
  it("marks the calendar account for reauthentication and tells the caller", async () => {
    selectResults = [[CREDENTIAL_ROW], [], [], []];
    stubUserInfoResponse(401, INVALID_AUTHENTICATION_TOKEN_BODY);

    const source = await connectOutlookSource();

    expect(calendarAccountInserts).toHaveLength(1);
    expect(calendarAccountInserts[0]?.needsReauthentication).toBe(true);
    expect(calendarAccountInserts[0]?.reauthenticationSource).not.toBeNull();
    expect(source.needsReauthentication).toBe(true);
  });

  it("leaves a brownout unflagged when the graph userinfo probe answers 503", async () => {
    selectResults = [[CREDENTIAL_ROW], [], [], []];
    stubUserInfoResponse(503, GRAPH_UNAVAILABLE_BODY);

    const source = await connectOutlookSource();

    expect(calendarSourceInserts).toHaveLength(1);
    expect(calendarAccountInserts).toHaveLength(1);
    expect(calendarAccountInserts[0]?.accountId).toBeNull();
    expect(calendarAccountInserts[0]?.needsReauthentication).toBe(false);
    expect(calendarAccountInserts[0]?.reauthenticationSource).toBeNull();
    expect(source.needsReauthentication).toBe(false);
  });
});
