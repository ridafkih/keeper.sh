import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { RotatedTokenNotPersistedError } from "@keeper.sh/calendar/oauth-persistence";
import type { createOAuthSource as createOAuthSourceFn } from "../../src/utils/oauth-sources";
import type * as RefreshCoordinatorModule
  from "../../../../packages/calendar/src/core/oauth/refresh-coordinator";

const COORDINATOR_MODULE = "../../../../packages/calendar/src/core/oauth/refresh-coordinator";

let createOAuthSource: typeof createOAuthSourceFn = () =>
  Promise.reject(new Error("Module not loaded"));
let runWithCredentialRefreshLock: typeof RefreshCoordinatorModule.runWithCredentialRefreshLock = () =>
  Promise.reject(new Error("Module not loaded"));

interface RecordedUpdate {
  table: string;
  values: Record<string, unknown>;
}

let recordedUpdates: RecordedUpdate[] = [];
let connectRefreshCalls: string[] = [];
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
      set: () => {},
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
          connectRefreshCalls.push(refreshToken);
          return Promise.reject(new Error("connect-path refresh must not run"));
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

  vi.mock("@keeper.sh/calendar", async () => {
    const coordinator = await vi.importActual<typeof RefreshCoordinatorModule>(COORDINATOR_MODULE);

    return {
      PROVIDER_DEFINITIONS: [],
      getActiveProviders: () => [],
      getCalDAVProviders: () => [],
      getOAuthProviders: () => [],
      getProvider: () => globalThis.undefined,
      getProvidersByAuthType: () => [],
      isCalDAVProvider: () => false,
      isOAuthProvider: () => true,
      isProviderId: () => true,
      runWithCredentialRefreshLock: coordinator.runWithCredentialRefreshLock,
    };
  });

  ({ createOAuthSource } = await import("../../src/utils/oauth-sources"));
  ({ runWithCredentialRefreshLock } = await vi.importActual<
    typeof RefreshCoordinatorModule
  >(COORDINATOR_MODULE));
});

afterAll(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  recordedUpdates = [];
  connectRefreshCalls = [];
  selectResults = [];
  txInstance = createTxInstance();
});

const PEER_REFRESH_DELAY_MS = 50;

const delay = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const nearlyExpiredCredentialRow = () => ({
  accessToken: "stale-access-token",
  email: "person@example.com",
  expiresAt: new Date(Date.now() + 30_000),
  needsReauthentication: false,
  provider: "outlook",
  refreshToken: "stored-refresh-token",
});

const startPeerRefreshFailingWith = (failure: Error) => {
  const peer = runWithCredentialRefreshLock("credential-1", async () => {
    await delay(PEER_REFRESH_DELAY_MS);
    throw failure;
  });

  return peer.catch(() => null);
};

const connect = () =>
  createOAuthSource({
    externalCalendarId: "primary",
    name: "Work",
    oauthCredentialId: "credential-1",
    provider: "outlook",
    userId: "user-1",
  });

describe("A coalesced lost rotation does not return 201 Created", () => {
  it("fails the connect when the joined peer refresh lost a rotated token", async () => {
    selectResults = [[nearlyExpiredCredentialRow()], [], [], [], []];
    const peerSettled = startPeerRefreshFailingWith(
      new RotatedTokenNotPersistedError(new Error("connection terminated unexpectedly")),
    );

    const outcome = await connect().then(
      (source) => ({ source }),
      (error: unknown) => ({ error }),
    );

    await peerSettled;

    expect(connectRefreshCalls).toEqual([]);
    expect(outcome).not.toHaveProperty("source");
    expect((outcome as { error?: unknown }).error).toBeInstanceOf(RotatedTokenNotPersistedError);
  });

  it("still degrades to a null provider account id on a plain provider failure", async () => {
    selectResults = [[nearlyExpiredCredentialRow()], [], [], [], []];
    const peerSettled = startPeerRefreshFailingWith(new Error("provider brownout"));

    const source = await connect();

    await peerSettled;

    expect(connectRefreshCalls).toEqual([]);
    expect(source.id).toBe("source-1");
    expect(source.needsReauthentication).toBe(false);
  });
});
