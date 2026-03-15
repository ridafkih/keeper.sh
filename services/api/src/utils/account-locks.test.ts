import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import type { createCalDAVDestination as createCalDAVDestinationFn } from "./caldav";
import type { createCalDAVSource as createCalDAVSourceFn } from "./caldav-sources";
import type { handleOAuthCallback as handleOAuthCallbackFn } from "./oauth";
import type {
  createOAuthSource as createOAuthSourceFn,
  importOAuthAccountCalendars as importOAuthAccountCalendarsFn,
} from "./oauth-sources";

let createCalDAVDestination: typeof createCalDAVDestinationFn = () =>
  Promise.reject(new Error("Module not loaded"));
let createCalDAVSource: typeof createCalDAVSourceFn = () =>
  Promise.reject(new Error("Module not loaded"));
let createOAuthSource: typeof createOAuthSourceFn = () =>
  Promise.reject(new Error("Module not loaded"));
let handleOAuthCallback: typeof handleOAuthCallbackFn = () =>
  Promise.reject(new Error("Module not loaded"));
let importOAuthAccountCalendars: typeof importOAuthAccountCalendarsFn = () =>
  Promise.reject(new Error("Module not loaded"));

let canAddAccountResult = true;
let destinationAccountId: string | null = null;
let googleCalendars = [{ id: "external-1", summary: "Team Calendar" }];
let hasRequiredScopesResult = true;
let insertCalls: unknown[] = [];
let saveCalDAVDestinationCalls: { accountId: string; transactionOpen: boolean; tx: object }[] = [];
let saveCalendarDestinationCalls: { accountId: string; needsReauthentication: boolean; transactionOpen: boolean; tx: object }[] = [];
let selectResults: unknown[][] = [];
let transactionOpen = false;
let triggerSyncCalls: string[] = [];
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
  values: (values: unknown) => {
    insertCalls.push(values);

    const valueChain = Promise.resolve() as Promise<void> & {
      onConflictDoNothing: () => Promise<void>;
      onConflictDoUpdate: () => { returning: () => Promise<unknown> };
      returning: () => Promise<unknown>;
    };
    valueChain.onConflictDoNothing = () => Promise.resolve();
    valueChain.onConflictDoUpdate = () => ({
      returning: () => Promise.resolve(result),
    });
    valueChain.returning = () => Promise.resolve(result);

    return valueChain;
  },
});

const createTxInstance = (): object => ({
  execute: () => Promise.resolve(),
  insert: () => createInsertBuilder([]),
  select: () => createSelectBuilder(selectResults.shift() ?? []),
  selectDistinct: () => ({
    from: () => ({}),
  }),
});

beforeAll(async () => {
  mock.module("../context", () => ({
    baseUrl: "https://keeper.test",
    database: {
      insert: () => {
        throw new Error("global database.insert should not be used");
      },
      select: () => {
        throw new Error("global database.select should not be used");
      },
      selectDistinct: () => ({
        from: () => ({}),
      }),
      transaction: async (callback: (tx: object) => Promise<unknown>) => {
        transactionOpen = true;
        try {
          return await callback(txInstance);
        } finally {
          transactionOpen = false;
        }
      },
    },
    encryptionKey: "encryption-key",
    premiumService: {
      canAddAccount: () => Promise.resolve(canAddAccountResult),
    },
  }));

  mock.module("./background-task", () => ({
    spawnBackgroundJob: (_jobName: string, fields: { userId: string }, _callback: () => Promise<void>) => {
      triggerSyncCalls.push(fields.userId);
    },
  }));

  mock.module("./destinations", () => ({
    exchangeCodeForTokens: () =>
      Promise.resolve((() => {
        let scope = "calendar.read";
        if (hasRequiredScopesResult) {
          scope = "calendar.read calendar.write";
        }

        return {
        access_token: "access-token",
        expires_in: 3600,
        refresh_token: "refresh-token",
          scope,
        };
      })()),
    fetchUserInfo: () =>
      Promise.resolve({
        email: "person@example.com",
        id: "external-account-1",
      }),
    getDestinationAccountId: () => Promise.resolve(destinationAccountId),
    hasRequiredScopes: () => Promise.resolve(hasRequiredScopesResult),
    saveCalDAVDestinationWithDatabase: (tx: object, _userId: string, _provider: string, accountId: string) => {
      saveCalDAVDestinationCalls.push({ accountId, transactionOpen, tx });
      return Promise.resolve();
    },
    saveCalendarDestinationWithDatabase: (
      tx: object,
      _userId: string,
      _provider: string,
      accountId: string,
      _email: string | null,
      _accessToken: string,
      _refreshToken: string,
      _expiresAt: Date,
      needsReauthentication = false,
    ) => {
      saveCalendarDestinationCalls.push({ accountId, needsReauthentication, transactionOpen, tx });
      return Promise.resolve();
    },
    validateState: () => {
      if (destinationAccountId) {
        return {
          destinationId: destinationAccountId,
          userId: "user-1",
        };
      }

      return { userId: "user-1" };
    },
  }));

  mock.module("./sync", () => ({
    triggerDestinationSync: (userId: string) => {
      triggerSyncCalls.push(userId);
    },
  }));

  mock.module("@keeper.sh/database", () => ({
    encryptPassword: () => "encrypted-password",
  }));

  mock.module("@keeper.sh/providers/caldav", () => ({
    createCalDAVClient: () => ({
      discoverCalendars: () => Promise.resolve([]),
    }),
    createCalDAVProvider: () => ({
      id: "icloud",
    }),
    createCalDAVSourceProvider: () => ({
      id: "icloud",
    }),
  }));

  mock.module("@keeper.sh/providers/google", () => ({
    createGoogleCalendarProvider: () => ({
      id: "google",
    }),
    createGoogleCalendarSourceProvider: () => ({
      id: "google",
    }),
    listUserCalendars: () => Promise.resolve(googleCalendars),
  }));

  mock.module("@keeper.sh/providers/outlook", () => ({
    createOutlookCalendarProvider: () => ({
      id: "outlook",
    }),
    createOutlookSourceProvider: () => ({
      id: "outlook",
    }),
    listUserCalendars: () => Promise.resolve([]),
  }));

  mock.module("@keeper.sh/providers", () => ({
    PROVIDER_DEFINITIONS: [],
    getActiveProviders: () => [],
    getCalDAVProviders: () => [],
    getOAuthProviders: () => [],
    getProvider: () => globalThis.undefined,
    getProvidersByAuthType: () => [],
    isCalDAVProvider: () => true,
    isOAuthProvider: () => false,
    isProviderId: () => false,
  }));

  ({
    handleOAuthCallback,
  } = await import("./oauth"));
  ({
    createOAuthSource,
    importOAuthAccountCalendars,
  } = await import("./oauth-sources"));
  ({
    createCalDAVDestination,
  } = await import("./caldav"));
  ({
    createCalDAVSource,
  } = await import("./caldav-sources"));
});

afterAll(() => {
  mock.restore();
});

beforeEach(() => {
  canAddAccountResult = true;
  destinationAccountId = null;
  googleCalendars = [{ id: "external-1", summary: "Team Calendar" }];
  hasRequiredScopesResult = true;
  insertCalls = [];
  saveCalDAVDestinationCalls = [];
  saveCalendarDestinationCalls = [];
  selectResults = [];
  transactionOpen = false;
  triggerSyncCalls = [];
  txInstance = createTxInstance();
});

describe("Account locks", () => {
  it("rechecks the OAuth destination cap inside the locked transaction", () => {
    canAddAccountResult = false;
    selectResults = [
      [],
      [{ id: "existing-account" }],
    ];

    expect(
      handleOAuthCallback({
        code: "oauth-code",
        error: null,
        provider: "google",
        state: "oauth-state",
      }),
    ).rejects.toMatchObject({
      message: "Account limit reached",
    });

    expect(saveCalendarDestinationCalls).toHaveLength(0);
  });

  it("persists OAuth reauthentication updates while the transaction lock is held", async () => {
    destinationAccountId = "external-account-1";
    hasRequiredScopesResult = false;

    await handleOAuthCallback({
      code: "oauth-code",
      error: null,
      provider: "google",
      state: "oauth-state",
    });

    expect(saveCalendarDestinationCalls).toEqual([
      {
        accountId: "external-account-1",
        needsReauthentication: true,
        transactionOpen: true,
        tx: txInstance,
      },
    ]);
  });

  it("creates OAuth sources without escaping the locked transaction", async () => {
    selectResults = [
      [{ email: "person@example.com" }],
      [],
      [],
      [],
    ];

    let insertStep = 0;
    txInstance = {
      execute: () => Promise.resolve(),
      insert: () => {
        insertStep += 1;
        if (insertStep === 1) {
          return createInsertBuilder([{ id: "account-1" }]);
        }

        return createInsertBuilder([{ id: "source-1", name: "Team Calendar" }]);
      },
      select: () => createSelectBuilder(selectResults.shift() ?? []),
      selectDistinct: () => ({
        from: () => ({}),
      }),
    };

    const source = await createOAuthSource({
      externalCalendarId: "external-1",
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
    expect(insertCalls).toHaveLength(2);
    expect(triggerSyncCalls).toEqual(["user-1"]);
  });

  it("imports OAuth calendars without escaping the locked transaction", async () => {
    selectResults = [
      [],
      [],
      [],
    ];

    let insertStep = 0;
    txInstance = {
      execute: () => Promise.resolve(),
      insert: () => {
        insertStep += 1;
        if (insertStep === 1) {
          return createInsertBuilder([{ id: "account-1" }]);
        }

        return createInsertBuilder(null);
      },
      select: () => createSelectBuilder(selectResults.shift() ?? []),
      selectDistinct: () => ({
        from: () => ({}),
      }),
    };

    const accountId = await importOAuthAccountCalendars({
      accessToken: "access-token",
      email: "person@example.com",
      oauthCredentialId: "credential-1",
      provider: "google",
      userId: "user-1",
    });

    expect(accountId).toBe("account-1");
    expect(insertCalls).toHaveLength(2);
    expect(triggerSyncCalls).toEqual(["user-1"]);
  });

  it("creates CalDAV destinations before releasing the transaction lock", async () => {
    selectResults = [
      [],
      [],
    ];

    await createCalDAVDestination(
      "user-1",
      "icloud",
      "https://caldav.test",
      {
        password: "secret",
        username: "person@example.com",
      },
      "https://caldav.test/team",
    );

    expect(saveCalDAVDestinationCalls).toEqual([
      {
        accountId: "person@example.com@caldav.test",
        transactionOpen: true,
        tx: txInstance,
      },
    ]);
    expect(triggerSyncCalls).toEqual(["user-1"]);
  });

  it("creates CalDAV sources through the locked transaction client", async () => {
    selectResults = [
      [],
      [],
      [],
    ];

    let insertStep = 0;
    txInstance = {
      execute: () => Promise.resolve(),
      insert: () => {
        insertStep += 1;
        if (insertStep === 1) {
          return createInsertBuilder([{ id: "credential-1" }]);
        }
        if (insertStep === 2) {
          return createInsertBuilder([{ id: "account-1" }]);
        }

        return createInsertBuilder([{
          createdAt: new Date("2026-03-10T12:00:00.000Z"),
          id: "source-1",
          name: "Team CalDAV",
          userId: "user-1",
        }]);
      },
      select: () => createSelectBuilder(selectResults.shift() ?? []),
      selectDistinct: () => ({
        from: () => ({}),
      }),
    };

    const source = await createCalDAVSource("user-1", {
      calendarUrl: "https://caldav.test/team",
      name: "Team CalDAV",
      password: "secret",
      provider: "icloud",
      serverUrl: "https://caldav.test",
      username: "person@example.com",
    });

    expect(source).toMatchObject({
      accountId: "account-1",
      calendarUrl: "https://caldav.test/team",
      id: "source-1",
      name: "Team CalDAV",
      provider: "icloud",
      userId: "user-1",
    });
    expect(triggerSyncCalls).toEqual(["user-1"]);
  });
});
