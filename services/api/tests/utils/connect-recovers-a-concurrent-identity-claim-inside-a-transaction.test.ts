import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import type { createOAuthSource as createOAuthSourceFn } from "../../src/utils/oauth-sources";

const PROVIDER_ACCOUNT_ID = "google-sub-7";
const CLAIMING_ACCOUNT_ROW_ID = "account-row-claimed-by-the-reaper";

let createOAuthSource: typeof createOAuthSourceFn = () =>
  Promise.reject(new Error("Module not loaded"));

let selectResults: unknown[][] = [];
let transactionState = { aborted: false, accountInsertAttempted: false };
let calendarSourceInserts: Record<string, unknown>[] = [];

const uniqueViolation = () =>
  Object.assign(
    new Error(
      'duplicate key value violates unique constraint "calendar_accounts_provider_account_idx"',
    ),
    {
      code: "ERR_POSTGRES_SERVER_ERROR",
      constraint: "calendar_accounts_provider_account_idx",
      detail: `Key ("userId", provider, "accountId")=(user-1, google, ${PROVIDER_ACCOUNT_ID}) already exists.`,
      errno: "23505",
    },
  );

const transactionAborted = () =>
  Object.assign(
    new Error("current transaction is aborted, commands ignored until end of transaction block"),
    {
      code: "ERR_POSTGRES_SERVER_ERROR",
      errno: "25P02",
    },
  );

type QueryChain = Promise<unknown[]> & {
  from: () => QueryChain;
  innerJoin: () => QueryChain;
  leftJoin: () => QueryChain;
  where: () => QueryChain;
  limit: () => QueryChain;
};

const createQueryChain = (settled: Promise<unknown[]>): QueryChain => {
  const chain = settled as QueryChain;
  chain.from = () => chain;
  chain.innerJoin = () => chain;
  chain.leftJoin = () => chain;
  chain.where = () => chain;
  chain.limit = () => chain;

  return chain;
};

const rejected = (error: unknown): Promise<never> =>
  new Promise<never>((_resolve, reject) => {
    reject(error);
  });

const rejectWithAbort = (): Promise<never> => rejected(transactionAborted());

const createSelect = () => {
  if (transactionState.aborted) {
    return createQueryChain(rejectWithAbort());
  }

  const rows = selectResults.shift() ?? [];
  return createQueryChain(Promise.resolve(rows));
};

const createSourceInsertBuilder = () => ({
  values: (values: unknown) => {
    calendarSourceInserts.push(...(values as Record<string, unknown>[]));

    const conflictChain = Promise.resolve() as Promise<void> & {
      returning: () => Promise<unknown>;
    };
    conflictChain.returning = () =>
      Promise.resolve([{ id: "source-1", name: "Team Calendar" }]);

    const valueChain = Promise.resolve() as Promise<void> & {
      onConflictDoNothing: () => typeof conflictChain;
      onConflictDoUpdate: () => { returning: () => Promise<unknown> };
      returning: () => Promise<unknown>;
    };
    valueChain.onConflictDoNothing = () => conflictChain;
    valueChain.onConflictDoUpdate = () => ({
      returning: () => Promise.resolve([{ id: "source-1", name: "Team Calendar" }]),
    });
    valueChain.returning = () => Promise.resolve([{ id: "source-1", name: "Team Calendar" }]);

    return valueChain;
  },
});

const createFeedInsertBuilder = (rows: unknown[]) => ({
  values: () => {
    const conflictChain = Promise.resolve() as Promise<void> & {
      returning: () => Promise<unknown>;
    };
    conflictChain.returning = () => Promise.resolve(rows);

    const valueChain = Promise.resolve() as Promise<void> & {
      onConflictDoNothing: () => typeof conflictChain;
      onConflictDoUpdate: () => { returning: () => Promise<unknown> };
      returning: () => Promise<unknown>;
    };
    valueChain.onConflictDoNothing = () => conflictChain;
    valueChain.onConflictDoUpdate = () => ({ returning: () => Promise.resolve(rows) });
    valueChain.returning = () => Promise.resolve(rows);

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

const createAbortedInsertBuilder = () => ({
  values: () => {
    const chain = rejectWithAbort() as Promise<never> & {
      onConflictDoNothing: () => typeof chain;
      onConflictDoUpdate: () => typeof chain;
      returning: () => typeof chain;
    };
    chain.onConflictDoNothing = () => chain;
    chain.onConflictDoUpdate = () => chain;
    chain.returning = () => chain;

    return chain;
  },
});

const insertForTable = (table: unknown) => {
  if (transactionState.aborted) {
    return createAbortedInsertBuilder();
  }

  const tableName = getTableName(table as never);

  if (tableName === "calendar_accounts") {
    if (!transactionState.accountInsertAttempted) {
      transactionState = { ...transactionState, accountInsertAttempted: true };

      return {
        values: () => ({
          returning: () => {
            transactionState = { ...transactionState, aborted: true };
            return rejected(uniqueViolation());
          },
        }),
      };
    }

    return createFeedInsertBuilder([{ id: CLAIMING_ACCOUNT_ROW_ID }]);
  }

  if (tableName === "ical_feeds") {
    return createFeedInsertBuilder([DEFAULT_FEED_ROW]);
  }

  if (tableName === "ical_feed_calendars") {
    return createFeedInsertBuilder([]);
  }

  return createSourceInsertBuilder();
};

const createUpdateBuilder = () => ({
  set: () => {
    const chain = Promise.resolve() as Promise<void> & { where: () => Promise<void> };
    chain.where = () =>
      transactionState.aborted ? rejectWithAbort() : Promise.resolve();

    return chain;
  },
});

const createTransactionClient = (): object => ({
  execute: () => (transactionState.aborted ? rejectWithAbort() : Promise.resolve()),
  insert: insertForTable,
  select: createSelect,
  selectDistinct: () => ({ from: () => ({}) }),
  transaction: async (callback: (child: object) => Promise<unknown>) => {
    try {
      return await callback(createTransactionClient());
    } catch (error) {
      transactionState = { ...transactionState, aborted: false };
      throw error;
    }
  },
  update: createUpdateBuilder,
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
      select: createSelect,
      selectDistinct: () => ({ from: () => ({}) }),
      transaction: (callback: (tx: object) => Promise<unknown>) =>
        callback(createTransactionClient()),
      update: createUpdateBuilder,
    },
    encryptionKey: "encryption-key",
    oauthProviders: {
      getProvider: () => ({
        exchangeCodeForTokens: () => Promise.reject(new Error("not used")),
        fetchUserInfo: () =>
          Promise.resolve({ email: "person@example.com", id: PROVIDER_ACCOUNT_ID }),
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

  vi.mock("@keeper.sh/database", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
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
  calendarSourceInserts = [];
  transactionState = { aborted: false, accountInsertAttempted: false };
});

const CREDENTIAL_ROW = {
  accessToken: "access-token-1",
  email: "person@example.com",
  expiresAt: new Date(Date.now() + 3_600_000),
  needsReauthentication: false,
  provider: "google",
  refreshToken: "refresh-token-1",
};

describe("a concurrent identity claim met inside the connect transaction", () => {
  it("recovers on the claiming row instead of failing the whole transaction", async () => {
    selectResults = [
      [CREDENTIAL_ROW],
      [],
      [],
      [],
      [],
      [],
      [{ id: CLAIMING_ACCOUNT_ROW_ID }],
    ];

    const source = await createOAuthSource({
      externalCalendarId: "primary",
      name: "Team Calendar",
      oauthCredentialId: "credential-1",
      provider: "google",
      userId: "user-1",
    });

    expect(source).toEqual({
      email: "person@example.com",
      id: "source-1",
      name: "Team Calendar",
      provider: "google",
    });
    expect(calendarSourceInserts).toHaveLength(1);
    expect(calendarSourceInserts[0]?.accountId).toBe(CLAIMING_ACCOUNT_ROW_ID);
  });
});
