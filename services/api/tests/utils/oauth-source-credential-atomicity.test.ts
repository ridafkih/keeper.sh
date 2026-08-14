import { calendarAccountsTable, calendarsTable, oauthCredentialsTable } from "@keeper.sh/database/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "credential-atomicity-user";
const CREDENTIAL_ID = "5f2a9d31-7c08-4b64-9e15-2d7a6b3c8f40";
const ACCOUNT_ID = "6a3b0e42-8d19-4c75-af26-3e8b7c4d9051";
const CALENDAR_ID = "7b4c1f53-9e20-4d86-b037-4f9c8d5e0162";

interface CredentialRow {
  accessToken: string;
  expiresAt: Date;
  needsReauthentication: boolean;
  refreshToken: string;
}

const state: {
  advisoryLocks: unknown[];
  calendarFailure: Error | null;
  committed: { credential: CredentialRow; flagged: boolean };
  transactions: number;
} = {
  advisoryLocks: [],
  calendarFailure: null,
  committed: {
    credential: {
      accessToken: "dead-access-token",
      expiresAt: new Date("2026-08-01T00:00:00.000Z"),
      needsReauthentication: true,
      refreshToken: "dead-refresh-token",
    },
    flagged: true,
  },
  transactions: 0,
};

type QueryChain = Promise<unknown[]> & Record<string, unknown>;

const createChain = (rows: unknown[]): QueryChain => {
  const chain = Promise.resolve(rows) as QueryChain;
  const passthrough = () => chain;
  chain.from = passthrough;
  chain.innerJoin = passthrough;
  chain.leftJoin = passthrough;
  chain.where = passthrough;
  chain.limit = passthrough;
  chain.orderBy = passthrough;
  chain.returning = passthrough;
  return chain;
};

const createClientWritingTo = (resolveStaged: () => { credential: CredentialRow; flagged: boolean }) => {
  const client = {
    execute: (statement: unknown) => {
      state.advisoryLocks.push(statement);
      return Promise.resolve();
    },
    insert: () => ({
      values: () => createChain([{ id: CREDENTIAL_ID }]),
    }),
    select: () => createChain([{ id: CREDENTIAL_ID, sourceAccountId: ACCOUNT_ID }]),
    transaction: (callback: (tx: unknown) => Promise<unknown>) => callback(client),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          const staged = resolveStaged();
          if (table === oauthCredentialsTable) {
            staged.credential = {
              accessToken: (values.accessToken ?? staged.credential.accessToken) as string,
              expiresAt: (values.expiresAt ?? staged.credential.expiresAt) as Date,
              needsReauthentication: values.needsReauthentication === true,
              refreshToken: (values.refreshToken ?? staged.credential.refreshToken) as string,
            };
            return createChain([{ id: CREDENTIAL_ID }]);
          }
          if (table === calendarAccountsTable) {
            staged.flagged = values.needsReauthentication === true;
            return createChain([{ id: ACCOUNT_ID }]);
          }
          if (table !== calendarsTable) {
            throw new Error("Unexpected table written by the credential reconnect");
          }
          if (state.calendarFailure) {
            return Promise.reject(state.calendarFailure);
          }
          return createChain([{ id: CALENDAR_ID }]);
        },
      }),
    }),
  };
  return client;
};

const databaseStub = {
  ...createClientWritingTo(() => state.committed),
  transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
    state.transactions += 1;
    const staged = {
      credential: { ...state.committed.credential },
      flagged: state.committed.flagged,
    };
    const result = await callback(createClientWritingTo(() => staged));
    state.committed = staged;
    return result;
  },
};

vi.mock("@/context", () => ({
  database: databaseStub,
}));

const { createOAuthSourceCredential } = await import("@/utils/oauth-source-credentials");

const reconnect = (): Promise<string> =>
  createOAuthSourceCredential(USER_ID, {
    accessToken: "fresh-access-token",
    email: "person@example.com",
    expiresAt: new Date("2026-09-01T00:00:00.000Z"),
    provider: "google",
    refreshToken: "fresh-refresh-token",
  });

beforeEach(() => {
  state.advisoryLocks = [];
  state.calendarFailure = null;
  state.committed = {
    credential: {
      accessToken: "dead-access-token",
      expiresAt: new Date("2026-08-01T00:00:00.000Z"),
      needsReauthentication: true,
      refreshToken: "dead-refresh-token",
    },
    flagged: true,
  };
  state.transactions = 0;
});

describe("reconnecting an OAuth source credential", () => {
  it("writes the fresh tokens and clears the armed reauthentication in one unit of work", async () => {
    await reconnect();

    expect(state.transactions).toBe(1);
    expect(state.advisoryLocks).toHaveLength(1);
    expect(state.committed.credential).toMatchObject({
      accessToken: "fresh-access-token",
      needsReauthentication: false,
      refreshToken: "fresh-refresh-token",
    });
    expect(state.committed.flagged).toBe(false);
  });

  it("leaves the dead credential in place when clearing the backoff fails", async () => {
    state.calendarFailure = new Error("deadlock detected on calendars");

    await expect(reconnect()).rejects.toThrow("deadlock detected");

    expect(state.committed.credential).toMatchObject({
      accessToken: "dead-access-token",
      needsReauthentication: true,
      refreshToken: "dead-refresh-token",
    });
    expect(state.committed.flagged).toBe(true);
  });
});
