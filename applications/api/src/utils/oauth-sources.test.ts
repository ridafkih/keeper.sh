import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import type {
  createOAuthSource as createOAuthSourceFn,
  importOAuthAccountCalendars as importOAuthAccountCalendarsFn,
} from "./oauth-sources";

type SelectResponse =
  | { kind: "direct"; value: unknown[] }
  | { kind: "limited"; value: unknown[] };

type InsertResponse =
  | { kind: "direct" }
  | { kind: "returning"; value: unknown[] };

let selectResponses: SelectResponse[] = [];
let insertResponses: InsertResponse[] = [];
let insertValuesCalls: unknown[] = [];
let canAddAccountCalls: [string, number][] = [];
let canAddAccountResult = true;
let listedCalendars: { id: string; summary: string }[] = [];
let spawnBackgroundJobCalls: { jobName: string; fields: Record<string, unknown> }[] = [];

const database = {
  insert: () => ({
    values: (values: unknown) => {
      insertValuesCalls.push(values);
      const response = insertResponses.shift() ?? { kind: "direct" };

      if (response.kind === "returning") {
        return {
          returning: () => Promise.resolve(response.value),
        };
      }

      return Promise.resolve();
    },
  }),
  select: () => ({
    from: () => {
      const resolveWhere = () => {
        const response = selectResponses.shift() ?? { kind: "direct", value: [] };

        if (response.kind === "limited") {
          return {
            limit: () => Promise.resolve(response.value),
          };
        }

        return Promise.resolve(response.value);
      };

      const chain = {
        innerJoin: () => chain,
        where: resolveWhere,
      };

      return chain;
    },
  }),
};

const premiumService = {
  canAddAccount: (userId: string, currentCount: number) => {
    canAddAccountCalls.push([userId, currentCount]);
    return Promise.resolve(canAddAccountResult);
  },
};

let importOAuthAccountCalendars: typeof importOAuthAccountCalendarsFn = () =>
  Promise.reject(new Error("Module not loaded"));
let createOAuthSource: typeof createOAuthSourceFn = () =>
  Promise.reject(new Error("Module not loaded"));

beforeAll(async () => {
  mock.module("../context", () => ({
    database,
    oauthProviders: {},
    premiumService,
  }));
  mock.module("./background-task", () => ({
    spawnBackgroundJob: (jobName: string, fields: Record<string, unknown>) => {
      spawnBackgroundJobCalls.push({ fields, jobName });
    },
  }));
  mock.module("./sync", () => ({
    triggerDestinationSync: () => null,
  }));
  mock.module("@keeper.sh/provider-registry/server", () => ({
    getSourceProvider: () => null,
  }));
  mock.module("@keeper.sh/provider-google-calendar", () => ({
    listUserCalendars: () => Promise.resolve(listedCalendars),
  }));
  mock.module("@keeper.sh/provider-outlook", () => ({
    listUserCalendars: () => Promise.resolve(listedCalendars),
  }));

  ({ createOAuthSource, importOAuthAccountCalendars } = await import("./oauth-sources"));
});

beforeEach(() => {
  selectResponses = [];
  insertResponses = [];
  insertValuesCalls = [];
  canAddAccountCalls = [];
  canAddAccountResult = true;
  listedCalendars = [];
  spawnBackgroundJobCalls = [];
});

describe("importOAuthAccountCalendars", () => {
  it("rejects creating a new OAuth account when the user is at the account limit", async () => {
    selectResponses = [
      { kind: "limited", value: [] },
      { kind: "direct", value: [{ id: "account-1" }, { id: "account-2" }] },
    ];
    canAddAccountResult = false;

    await expect(
      importOAuthAccountCalendars({
        accessToken: "token",
        email: "person@example.com",
        oauthCredentialId: "credential-1",
        provider: "google",
        userId: "user-1",
      }),
    ).rejects.toThrow("Account limit reached");

    expect(canAddAccountCalls).toEqual([["user-1", 2]]);
    expect(insertValuesCalls).toHaveLength(0);
    expect(spawnBackgroundJobCalls).toHaveLength(0);
  });

  it("reuses an existing OAuth account without checking the account limit", async () => {
    selectResponses = [
      { kind: "limited", value: [{ id: "account-1" }] },
      { kind: "direct", value: [] },
    ];
    listedCalendars = [{ id: "external-1", summary: "Team Calendar" }];

    const accountId = await importOAuthAccountCalendars({
      accessToken: "token",
      email: "person@example.com",
      oauthCredentialId: "credential-1",
      provider: "google",
      userId: "user-1",
    });

    expect(accountId).toBe("account-1");
    expect(canAddAccountCalls).toHaveLength(0);
    expect(insertValuesCalls).toEqual([
      [
        expect.objectContaining({
          accountId: "account-1",
          externalCalendarId: "external-1",
          name: "Team Calendar",
          userId: "user-1",
        }),
      ],
    ]);
    expect(spawnBackgroundJobCalls).toEqual([
      {
        fields: { provider: "google", userId: "user-1" },
        jobName: "oauth-account-import",
      },
    ]);
  });
});

describe("createOAuthSource", () => {
  it("reuses an existing OAuth account without checking the account limit", async () => {
    selectResponses = [
      { kind: "limited", value: [{ email: "person@example.com" }] },
      { kind: "limited", value: [{ id: "account-1" }] },
      { kind: "limited", value: [] },
    ];
    canAddAccountResult = false;
    insertResponses = [
      { kind: "returning", value: [{ id: "source-1", name: "Team Calendar" }] },
    ];

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
    expect(canAddAccountCalls).toHaveLength(0);
    expect(insertValuesCalls).toEqual([
      expect.objectContaining({
        accountId: "account-1",
        externalCalendarId: "external-1",
        name: "Team Calendar",
        userId: "user-1",
      }),
    ]);
    expect(spawnBackgroundJobCalls).toEqual([
      {
        fields: { provider: "google", userId: "user-1" },
        jobName: "oauth-source-sync",
      },
    ]);
  });

  it("checks the account limit before creating a new OAuth account", async () => {
    selectResponses = [
      { kind: "limited", value: [{ email: "person@example.com" }] },
      { kind: "limited", value: [] },
      { kind: "limited", value: [] },
      { kind: "direct", value: [{ id: "account-1" }, { id: "account-2" }] },
    ];
    canAddAccountResult = false;

    await expect(
      createOAuthSource({
        externalCalendarId: "external-1",
        name: "Team Calendar",
        oauthCredentialId: "credential-1",
        provider: "google",
        userId: "user-1",
      }),
    ).rejects.toThrow("Account limit reached");

    expect(canAddAccountCalls).toEqual([["user-1", 2]]);
    expect(insertValuesCalls).toHaveLength(0);
    expect(spawnBackgroundJobCalls).toHaveLength(0);
  });
});
