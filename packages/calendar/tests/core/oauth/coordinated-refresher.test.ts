import { calendarAccountsTable, oauthCredentialsTable } from "@keeper.sh/database/schema";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { describe, expect, it } from "vitest";
import { createCoordinatedRefresher } from "../../../src/core/oauth/coordinated-refresher";

const ACCOUNT_ID = "c8a2f5d1-3b47-4e69-8c02-9f1d6a4b7e35";
const FAILED_REFRESH_TOKEN = "revoked-refresh-token";
const RECONNECTED_REFRESH_TOKEN = "reconnected-refresh-token";

interface RecordedWrite {
  table: string;
  values: Record<string, unknown>;
}

const tableNames = new Map<unknown, string>([
  [calendarAccountsTable, "calendar_accounts"],
  [oauthCredentialsTable, "oauth_credentials"],
]);

const resolveTableName = (table: unknown): string => {
  const name = tableNames.get(table);
  if (!name) {
    throw new Error("Unexpected table written by the coordinated refresher");
  }
  return name;
};

const dialect = new PgDialect();

// The flag write is a compare-and-set: it matches only while the credential still holds the failed token.
const guardMatches = (condition: unknown, storedRefreshToken: string | null): boolean => {
  if (storedRefreshToken === null) {
    return false;
  }
  const { params } = dialect.sqlToQuery(condition as SQL);
  return params.includes(storedRefreshToken);
};

const createDatabaseStub = (storedRefreshToken: () => string | null) => {
  const writes: RecordedWrite[] = [];
  const database = {
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: (condition: unknown) => {
          const name = resolveTableName(table);
          if (name === "calendar_accounts" && !guardMatches(condition, storedRefreshToken())) {
            return Promise.resolve([]);
          }
          writes.push({ table: name, values });
          return Promise.resolve([]);
        },
      }),
    }),
  };

  return { database: database as unknown as BunSQLDatabase, writes };
};

const deadCredentialRefresh = () =>
  Promise.reject(new Error("Token refresh failed (400): invalid_grant"));

describe("a refresh that fails because the credential is dead", () => {
  it("flags the account when the failed refresh token is still the stored one", async () => {
    const { database, writes } = createDatabaseStub(() => FAILED_REFRESH_TOKEN);
    const refresh = createCoordinatedRefresher({
      calendarAccountId: ACCOUNT_ID,
      database,
      oauthCredentialId: "3d9b6c02-5f18-4a73-b6e4-8c25d0f7a913",
      rawRefresh: deadCredentialRefresh,
      refreshLockStore: null,
    });

    await expect(refresh(FAILED_REFRESH_TOKEN)).rejects.toThrow("invalid_grant");

    expect(writes).toEqual([
      {
        table: "calendar_accounts",
        values: { needsReauthentication: true, reauthenticationSource: "token-refresh" },
      },
    ]);
  });

  it("leaves the account alone when a reconnect already replaced the credential", async () => {
    const { database, writes } = createDatabaseStub(() => RECONNECTED_REFRESH_TOKEN);
    const refresh = createCoordinatedRefresher({
      calendarAccountId: ACCOUNT_ID,
      database,
      oauthCredentialId: "7e41a8b5-9c63-4d20-8f57-1b3e6a9c4d08",
      rawRefresh: deadCredentialRefresh,
      refreshLockStore: null,
    });

    await expect(refresh(FAILED_REFRESH_TOKEN)).rejects.toThrow("invalid_grant");

    expect(writes).toEqual([]);
  });
});
