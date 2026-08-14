import { calendarAccountsTable, calendarsTable, oauthCredentialsTable } from "@keeper.sh/database/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";

const CREDENTIAL_ID = "8f0c3fbe-7be6-4e42-9bd5-1c2f3a4b5c6d";
const USER_ID = "0d8a0f10-2f6f-4a58-9e17-3c1b2a5d6e7f";
const ACCOUNT_IDS = [
  "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
];

interface RecordedUpdate {
  table: string;
  values: Record<string, unknown>;
}

const tableNames = new Map<unknown, string>([
  [calendarAccountsTable, "calendar_accounts"],
  [calendarsTable, "calendars"],
  [oauthCredentialsTable, "oauth_credentials"],
]);

const state: {
  accountIds: string[];
  existingCredential: { id: string } | null;
  updates: RecordedUpdate[];
  calendarUpdateError: Error | null;
} = {
  accountIds: [],
  existingCredential: null,
  updates: [],
  calendarUpdateError: null,
};

const resolveTableName = (table: unknown): string => {
  const name = tableNames.get(table);
  if (!name) {
    throw new Error("Unexpected table in reconnect flow");
  }
  return name;
};

const resolveUpdatedRows = (name: string): { id: string }[] => {
  if (name !== "calendar_accounts") {
    return [];
  }
  return state.accountIds.map((id) => ({ id }));
};

const selectCredentialRows = () =>
  [state.existingCredential].filter((row): row is { id: string } => row !== null)
    .map((row) => ({ ...row, sourceAccountId: ACCOUNT_IDS[0] ?? null }));

const databaseStub = {
  execute: () => Promise.resolve(),
  transaction: (callback: (tx: unknown) => Promise<unknown>) => callback(databaseStub),
  select: () => ({
    from: () => ({
      leftJoin: () => ({
        where: () => ({
          orderBy: () => Promise.resolve(selectCredentialRows()),
        }),
      }),
    }),
  }),
  insert: () => ({
    values: () => ({
      returning: () => Promise.resolve([{ id: CREDENTIAL_ID }]),
    }),
  }),
  update: (table: unknown) => ({
    set: (values: Record<string, unknown>) => {
      const name = resolveTableName(table);
      state.updates.push({ table: name, values });
      const rows = resolveUpdatedRows(name);
      const where = () => {
        if (name === "calendars" && state.calendarUpdateError) {
          const rejection = Promise.reject(state.calendarUpdateError);
          return Object.assign(rejection, { returning: () => rejection });
        }
        const result = Promise.resolve(rows);
        return Object.assign(result, { returning: () => result });
      };
      return { where };
    },
  }),
};

vi.mock("@/context", () => ({ database: databaseStub }));

const { createOAuthSourceCredential } = await import("@/utils/oauth-source-credentials");

const reconnectPayload = {
  accessToken: "fresh-access-token",
  email: "person@example.com",
  expiresAt: new Date("2026-08-12T12:00:00.000Z"),
  provider: "google",
  refreshToken: "fresh-refresh-token",
};

describe("reconnecting an OAuth source", () => {
  beforeEach(() => {
    state.accountIds = [...ACCOUNT_IDS];
    state.existingCredential = { id: CREDENTIAL_ID };
    state.updates = [];
    state.calendarUpdateError = null;
  });

  it("clears the sticky reauthentication marker and both backoff clocks", async () => {
    await createOAuthSourceCredential(USER_ID, reconnectPayload);

    expect(state.updates.map(({ table }) => table)).toEqual([
      "oauth_credentials",
      "calendar_accounts",
      "calendars",
    ]);
    expect(state.updates[2]?.values).toEqual({
      failureCount: 0,
      lastFailureAt: null,
      nextAttemptAt: null,
      ingestFailureCount: 0,
      ingestLastFailureAt: null,
      ingestNextAttemptAt: null,
    });
  });

  it("converges when the user reconnects twice in a row", async () => {
    await createOAuthSourceCredential(USER_ID, reconnectPayload);
    const first = [...state.updates];
    state.updates = [];

    await createOAuthSourceCredential(USER_ID, reconnectPayload);

    expect(state.updates).toEqual(first);
  });

  it("surfaces a failed backoff clear and stays recoverable on the next attempt", async () => {
    state.calendarUpdateError = new Error("canceling statement due to statement timeout");

    const failure = await createOAuthSourceCredential(USER_ID, reconnectPayload)
      .catch((error: unknown) => error);
    expect(failure).toBe(state.calendarUpdateError);

    state.calendarUpdateError = null;
    state.updates = [];

    expect(await createOAuthSourceCredential(USER_ID, reconnectPayload)).toBe(CREDENTIAL_ID);
    expect(state.updates.map(({ table }) => table)).toEqual([
      "oauth_credentials",
      "calendar_accounts",
      "calendars",
    ]);
  });

  it("performs no clearing work when the credential is created for the first time", async () => {
    state.existingCredential = null;

    expect(await createOAuthSourceCredential(USER_ID, reconnectPayload)).toBe(CREDENTIAL_ID);
    expect(state.updates).toEqual([]);
  });
});
