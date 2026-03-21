import { beforeEach, describe, expect, it } from "bun:test";
import {
  createOAuthSourceWithDependencies,
  importOAuthAccountCalendarsWithDependencies,
  UnsupportedOAuthProviderError,
} from "./oauth-sources";

let canAddAccountCalls: [string, number][] = [];
let canAddAccountResult = true;
let createAccountCalls: unknown[] = [];
let createSourceCalls: unknown[] = [];
let insertCalendarsCalls: unknown[] = [];
let triggerSyncCalls: { provider: string; userId: string }[] = [];
let listedCalendars: { externalId: string; name: string }[] = [];

beforeEach(() => {
  canAddAccountCalls = [];
  canAddAccountResult = true;
  createAccountCalls = [];
  createSourceCalls = [];
  insertCalendarsCalls = [];
  triggerSyncCalls = [];
  listedCalendars = [];
});

describe("importOAuthAccountCalendarsWithDependencies", () => {
  it("fails fast on unsupported providers for account import", () => {
    expect(
      importOAuthAccountCalendarsWithDependencies(
        {
          accessToken: "token",
          email: "person@example.com",
          oauthCredentialId: "credential-1",
          provider: "icloud",
          userId: "user-1",
        },
        {
          canAddAccount: () => Promise.resolve(true),
          countUserAccounts: () => Promise.resolve(0),
          createAccountId: () => Promise.resolve("account-1"),
          findExistingAccountId: () => Promise.resolve(null),
          getUnimportedExternalCalendars: () => Promise.resolve([]),
          insertCalendars: () => Promise.resolve(),
          listCalendars: () => Promise.resolve([]),
          triggerSync: () => null,
        },
      ),
    ).rejects.toBeInstanceOf(UnsupportedOAuthProviderError);
  });

  it("rejects creating a new OAuth account when the user is at the account limit", () => {
    canAddAccountResult = false;

    expect(
      importOAuthAccountCalendarsWithDependencies(
        {
          accessToken: "token",
          email: "person@example.com",
          oauthCredentialId: "credential-1",
          provider: "google",
          userId: "user-1",
        },
        {
          canAddAccount: (userId, currentCount) => {
            canAddAccountCalls.push([userId, currentCount]);
            return Promise.resolve(canAddAccountResult);
          },
          countUserAccounts: () => Promise.resolve(2),
          createAccountId: () => Promise.resolve("account-1"),
          findExistingAccountId: () => Promise.resolve(null),
          getUnimportedExternalCalendars: () => Promise.resolve([]),
          insertCalendars: () => Promise.resolve(),
          listCalendars: () => Promise.resolve([]),
          triggerSync: () => null,
        },
      ),
    ).rejects.toThrow("Account limit reached");

    expect(canAddAccountCalls).toEqual([["user-1", 2]]);
    expect(insertCalendarsCalls).toHaveLength(0);
    expect(triggerSyncCalls).toHaveLength(0);
  });

  it("reuses an existing OAuth account without checking the account limit", async () => {
    listedCalendars = [{ externalId: "external-1", name: "Team Calendar" }];

    const accountId = await importOAuthAccountCalendarsWithDependencies(
      {
        accessToken: "token",
        email: "person@example.com",
        oauthCredentialId: "credential-1",
        provider: "google",
        userId: "user-1",
      },
      {
        canAddAccount: (userId, currentCount) => {
          canAddAccountCalls.push([userId, currentCount]);
          return Promise.resolve(false);
        },
        countUserAccounts: () => Promise.resolve(2),
        createAccountId: () => Promise.resolve("new-account"),
        findExistingAccountId: () => Promise.resolve("account-1"),
        getUnimportedExternalCalendars: (_userId, _accountId, calendars) => Promise.resolve(calendars),
        insertCalendars: (_userId, _accountId, calendars) => {
          insertCalendarsCalls.push(calendars);
          return Promise.resolve();
        },
        listCalendars: () => Promise.resolve(listedCalendars),
        triggerSync: (userId, provider) => {
          triggerSyncCalls.push({ provider, userId });
        },
      },
    );

    expect(accountId).toBe("account-1");
    expect(canAddAccountCalls).toHaveLength(0);
    expect(insertCalendarsCalls).toEqual([[{ externalId: "external-1", name: "Team Calendar" }]]);
    expect(triggerSyncCalls).toEqual([{ provider: "google", userId: "user-1" }]);
  });
});

describe("createOAuthSourceWithDependencies", () => {
  it("fails fast on unsupported providers for source creation", () => {
    expect(
      createOAuthSourceWithDependencies(
        {
          externalCalendarId: "external-1",
          name: "Team Calendar",
          oauthCredentialId: "credential-1",
          provider: "icloud",
          userId: "user-1",
        },
        {
          canAddAccount: () => Promise.resolve(true),
          countUserAccounts: () => Promise.resolve(0),
          createCalendarAccount: () => Promise.resolve("account-1"),
          createSource: () => Promise.resolve({ id: "source-1", name: "Team Calendar" }),
          findCredentialEmail: () => Promise.resolve({ email: "person@example.com", exists: true }),
          findExistingAccountId: () => Promise.resolve(null),
          hasExistingCalendar: () => Promise.resolve(false),
          triggerSync: () => null,
        },
      ),
    ).rejects.toBeInstanceOf(UnsupportedOAuthProviderError);
  });

  it("allows source credentials whose email is null", async () => {
    const source = await createOAuthSourceWithDependencies(
      {
        externalCalendarId: "external-1",
        name: "Team Calendar",
        oauthCredentialId: "credential-1",
        provider: "google",
        userId: "user-1",
      },
      {
        canAddAccount: (userId, currentCount) => {
          canAddAccountCalls.push([userId, currentCount]);
          return Promise.resolve(true);
        },
        countUserAccounts: () => Promise.resolve(0),
        createCalendarAccount: (payload) => {
          createAccountCalls.push(payload);
          return Promise.resolve("account-1");
        },
        createSource: (payload) => {
          createSourceCalls.push(payload);
          return Promise.resolve({ id: "source-1", name: "Team Calendar" });
        },
        findCredentialEmail: () => Promise.resolve({ email: null, exists: true }),
        findExistingAccountId: () => Promise.resolve(null),
        hasExistingCalendar: () => Promise.resolve(false),
        triggerSync: (userId, provider) => {
          triggerSyncCalls.push({ provider, userId });
        },
      },
    );

    expect(source).toEqual({
      email: null,
      id: "source-1",
      name: "Team Calendar",
      provider: "google",
    });
    expect(createAccountCalls).toEqual([
      expect.objectContaining({
        displayName: null,
        email: null,
      }),
    ]);
  });

  it("reuses an existing OAuth account without checking the account limit", async () => {
    const source = await createOAuthSourceWithDependencies(
      {
        externalCalendarId: "external-1",
        name: "Team Calendar",
        oauthCredentialId: "credential-1",
        provider: "google",
        userId: "user-1",
      },
      {
        canAddAccount: (userId, currentCount) => {
          canAddAccountCalls.push([userId, currentCount]);
          return Promise.resolve(false);
        },
        countUserAccounts: () => Promise.resolve(2),
        createCalendarAccount: (payload) => {
          createAccountCalls.push(payload);
          return Promise.resolve("new-account");
        },
        createSource: (payload) => {
          createSourceCalls.push(payload);
          return Promise.resolve({ id: "source-1", name: "Team Calendar" });
        },
        findCredentialEmail: () => Promise.resolve({ email: "person@example.com", exists: true }),
        findExistingAccountId: () => Promise.resolve("account-1"),
        hasExistingCalendar: () => Promise.resolve(false),
        triggerSync: (userId, provider) => {
          triggerSyncCalls.push({ provider, userId });
        },
      },
    );

    expect(source).toEqual({
      email: "person@example.com",
      id: "source-1",
      name: "Team Calendar",
      provider: "google",
    });
    expect(canAddAccountCalls).toHaveLength(0);
    expect(createAccountCalls).toHaveLength(0);
    expect(createSourceCalls).toEqual([
      expect.objectContaining({
        accountId: "account-1",
        externalCalendarId: "external-1",
        name: "Team Calendar",
        userId: "user-1",
      }),
    ]);
    expect(triggerSyncCalls).toEqual([{ provider: "google", userId: "user-1" }]);
  });

  it("checks the account limit before creating a new OAuth account", () => {
    canAddAccountResult = false;

    expect(
      createOAuthSourceWithDependencies(
        {
          externalCalendarId: "external-1",
          name: "Team Calendar",
          oauthCredentialId: "credential-1",
          provider: "google",
          userId: "user-1",
        },
        {
          canAddAccount: (userId, currentCount) => {
            canAddAccountCalls.push([userId, currentCount]);
            return Promise.resolve(canAddAccountResult);
          },
          countUserAccounts: () => Promise.resolve(2),
          createCalendarAccount: () => Promise.resolve("new-account"),
          createSource: () => Promise.resolve({ id: "source-1", name: "Team Calendar" }),
          findCredentialEmail: () => Promise.resolve({ email: "person@example.com", exists: true }),
          findExistingAccountId: () => Promise.resolve(null),
          hasExistingCalendar: () => Promise.resolve(false),
          triggerSync: () => null,
        },
      ),
    ).rejects.toThrow("Account limit reached");

    expect(canAddAccountCalls).toEqual([["user-1", 2]]);
    expect(createAccountCalls).toHaveLength(0);
    expect(createSourceCalls).toHaveLength(0);
    expect(triggerSyncCalls).toHaveLength(0);
  });
});
