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

interface RecordedPredicate {
  table: string;
  tokens: string[];
}

interface RefreshResult {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

type RefreshBehaviour = (
  refreshToken: string,
  options?: { signal?: AbortSignal },
) => Promise<RefreshResult>;

let recordedInserts: RecordedWrite[] = [];
let recordedUpdates: RecordedWrite[] = [];
let recordedPredicates: RecordedPredicate[] = [];
let recordedWideFields: Record<string, unknown> = {};
let presentedRefreshTokens: string[] = [];
let credentialUpdateRowCount = 1;
let txInstance: object = {};
let refreshBehaviour: RefreshBehaviour = () =>
  Promise.reject(new Error("No refresh behaviour installed"));

const SHORT_CONNECT_CEILING_MS = 700;
const SHORT_CONNECT_BUDGET_MS = 200;
const SHORT_REQUEST_HARD_CAP_MS = 1500;
const LATE_ARRIVAL_MS = 450;
const DETACHED_WORK_ALLOWANCE_MS = 4000;
const DETACHED_WORK_POLL_MS = 10;
const CASE_TIMEOUT_MS = 30_000;
const MS_PER_SECOND = 1000;
const ACCESS_TOKEN_LIFETIME_SECONDS = 3600;
const NOTHING_ADOPTABLE_REMAINING_MS = Math.floor(TOKEN_REFRESH_BUFFER_MS / 2);
const CONNECT_ACCESS_TOKEN = "connect-access-token";
const CONNECT_REFRESH_TOKEN = "connect-refresh-token";
const LATE_ACCESS_TOKEN = "late-access-token";
const LATE_ROTATED_REFRESH_TOKEN = "late-rotated-refresh-token";

const answersAfterTheConnectDeadlineWithARotation: RefreshBehaviour = () =>
  new Promise<RefreshResult>((resolve) => {
    setTimeout(
      () =>
        resolve({
          access_token: LATE_ACCESS_TOKEN,
          expires_in: ACCESS_TOKEN_LIFETIME_SECONDS,
          refresh_token: LATE_ROTATED_REFRESH_TOKEN,
        }),
      LATE_ARRIVAL_MS,
    );
  });

const stringsWithin = (node: unknown): string[] => {
  const visited = new WeakSet<object>();

  const walk = (value: unknown): string[] => {
    if (typeof value === "string") {
      return [value];
    }

    if (typeof value !== "object" || value === null) {
      return [];
    }

    if (visited.has(value)) {
      return [];
    }

    visited.add(value);

    if (Array.isArray(value)) {
      return value.flatMap((entry) => walk(entry));
    }

    return Object.values(value).flatMap((entry) => walk(entry));
  };

  return walk(node);
};

const settledWithin = async <Result>(
  read: () => Result | null,
  withinMs: number,
): Promise<Result | "never-happened"> => {
  const giveUpAt = Date.now() + withinMs;

  while (Date.now() < giveUpAt) {
    const observed = read();

    if (observed !== null) {
      return observed;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, DETACHED_WORK_POLL_MS);
    });
  }

  return "never-happened";
};

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
    const tableName = getTableName(table as never);

    recordedUpdates.push({ table: tableName, values });

    const outcome = { rowCount: credentialUpdateRowCount };
    const chain = Promise.resolve(outcome) as Promise<typeof outcome> & {
      where: (predicate: unknown) => Promise<typeof outcome>;
    };

    chain.where = (predicate: unknown) => {
      recordedPredicates.push({ table: tableName, tokens: stringsWithin(predicate) });

      return Promise.resolve(outcome);
    };

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
    openConnectDeadline: () =>
      (
        actual.openConnectDeadline as (
          wallTimeCeilingMs?: number,
          requestHardCapMs?: number,
        ) => ReturnType<typeof actual.openConnectDeadline>
      )(SHORT_CONNECT_CEILING_MS, SHORT_REQUEST_HARD_CAP_MS),
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
      refreshAccessToken: (refreshToken: string, options?: { signal?: AbortSignal }) => {
        presentedRefreshTokens.push(refreshToken);

        return refreshBehaviour(refreshToken, options);
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
  recordedPredicates = [];
  recordedWideFields = {};
  presentedRefreshTokens = [];
  credentialUpdateRowCount = 1;
  refreshBehaviour = answersAfterTheConnectDeadlineWithARotation;
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

const credentialPredicates = () =>
  recordedPredicates.filter((predicate) => predicate.table === "oauth_credentials");

const awaitDetachedCredentialWrite = () =>
  settledWithin(
    () => {
      const [update] = credentialUpdates();
      const [predicate] = credentialPredicates();

      return update && predicate ? { predicate, update } : null;
    },
    DETACHED_WORK_ALLOWANCE_MS,
  );

const awaitReportedRotationLoss = () =>
  settledWithin(
    () => (recordedWideFields["token.rotation_lost"] === true ? true : null),
    DETACHED_WORK_ALLOWANCE_MS,
  );

describe("Connect refresh adopts a late-landing rotation", () => {
  it("persists the rotation that lands after the connect gave up", async () => {
    const startedAt = Date.now();
    const source = await connect();
    const connectElapsedMs = Date.now() - startedAt;

    expect(source.id).toBe("source-1");
    expect(connectElapsedMs).toBeLessThan(LATE_ARRIVAL_MS);
    expect(presentedRefreshTokens).toEqual([CONNECT_REFRESH_TOKEN]);
    expect(connectElapsedMs).toBeGreaterThanOrEqual(SHORT_CONNECT_BUDGET_MS);
    expect(recordedWideFields["oauth_source.provider_account_id_resolution"])
      .toBe("provider_failure");
    expect(credentialUpdates()).toEqual([]);

    const detached = await awaitDetachedCredentialWrite();

    expect(detached).not.toBe("never-happened");

    if (detached === "never-happened") {
      return;
    }

    expect(detached.update.values).toMatchObject({
      accessToken: LATE_ACCESS_TOKEN,
      refreshToken: LATE_ROTATED_REFRESH_TOKEN,
    });
    expect(detached.predicate.tokens).toContain(CONNECT_REFRESH_TOKEN);
    expect(recordedWideFields["token.rotation_recovered"]).toBe(true);
    expect(recordedWideFields["token.rotation_lost"]).not.toBe(true);
  }, CASE_TIMEOUT_MS);

  it("reports the loss when the stored row no longer holds the presented token", async () => {
    credentialUpdateRowCount = 0;

    await connect();

    const detached = await awaitDetachedCredentialWrite();

    expect(detached).not.toBe("never-happened");

    if (detached === "never-happened") {
      return;
    }

    expect(detached.predicate.tokens).toContain(CONNECT_REFRESH_TOKEN);

    const rotationLost = await awaitReportedRotationLoss();

    expect(rotationLost).toBe(true);
    expect(recordedWideFields["token.rotation_recovered"]).toBeUndefined();
  }, CASE_TIMEOUT_MS);
});
