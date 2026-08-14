import { calendarAccountsTable, oauthCredentialsTable } from "@keeper.sh/database/schema";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { describe, expect, it } from "vitest";
import { createCoordinatedRefresher } from "../../../src/core/oauth/coordinated-refresher";

const ACCOUNT_ID = "2b7e9c14-6d08-4f35-a92c-5e0b1d8a3f76";
const CREDENTIAL_ID = "8f4a1c05-2e63-47d9-b810-3c9e6f2a5d41";
const FAILED_REFRESH_TOKEN = "revoked-refresh-token";

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

interface StubOptions {
  storedRefreshToken: string | null;
  updateResult?: (table: string) => Promise<unknown>;
}

interface RecordedStatement {
  params: unknown[];
  table: string;
}

const dialect = new PgDialect();

// The flag write is a compare-and-set: it matches only while the credential still holds the failed token.
const guardMatches = (condition: unknown, storedRefreshToken: string | null): boolean => {
  if (storedRefreshToken === null) {
    return false;
  }
  const { params } = dialect.sqlToQuery(condition as SQL);
  return params.includes(storedRefreshToken);
};

const createDatabaseStub = (options: StubOptions) => {
  const writes: RecordedWrite[] = [];
  const statements: RecordedStatement[] = [];
  const database = {
    update: (table: unknown) => {
      const name = resolveTableName(table);
      return {
        set: (values: Record<string, unknown>) => ({
          where: (condition: unknown) => {
            statements.push({ params: dialect.sqlToQuery(condition as SQL).params, table: name });
            const result = options.updateResult?.(name);
            if (result) {
              return result;
            }
            if (name === "calendar_accounts"
              && !guardMatches(condition, options.storedRefreshToken)) {
              return Promise.resolve([]);
            }
            writes.push({ table: name, values });
            return Promise.resolve([]);
          },
        }),
      };
    },
  };

  return { database: database as unknown as BunSQLDatabase, statements, writes };
};

const deadCredentialRefresh = () =>
  Promise.reject(new Error("Token refresh failed (400): invalid_grant"));

type RawRefresh = () => Promise<{
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}>;

const buildRefresher = (database: BunSQLDatabase, rawRefresh: RawRefresh) =>
  createCoordinatedRefresher({
    calendarAccountId: ACCOUNT_ID,
    database,
    oauthCredentialId: CREDENTIAL_ID,
    rawRefresh,
    refreshLockStore: null,
  });

describe("the guard that checks whether the failed refresh token is still stored", () => {
  it("decides and writes in one statement, leaving no read-then-write window", async () => {
    const { database, statements } = createDatabaseStub({
      storedRefreshToken: FAILED_REFRESH_TOKEN,
    });
    const refresh = buildRefresher(database, deadCredentialRefresh);

    await expect(refresh(FAILED_REFRESH_TOKEN)).rejects.toThrow("invalid_grant");

    expect(statements).toHaveLength(1);
    expect(statements[0]?.table).toBe("calendar_accounts");
    expect(statements[0]?.params).toContain(FAILED_REFRESH_TOKEN);
    expect(statements[0]?.params).toContain(CREDENTIAL_ID);
  });

  it("keeps the credential failure classifiable when the marker write fails", async () => {
    const { database } = createDatabaseStub({
      storedRefreshToken: FAILED_REFRESH_TOKEN,
      updateResult: (table) => {
        if (table === "calendar_accounts") {
          return Promise.reject(new Error("deadlock detected on calendar_accounts"));
        }
        return Promise.resolve([]);
      },
    });
    const refresh = buildRefresher(database, deadCredentialRefresh);

    await expect(refresh(FAILED_REFRESH_TOKEN)).rejects.toThrow("invalid_grant");
  });

  it("leaves the account alone when the credential row has been deleted", async () => {
    const { database, writes } = createDatabaseStub({
      storedRefreshToken: null,
    });
    const refresh = buildRefresher(database, deadCredentialRefresh);

    await expect(refresh(FAILED_REFRESH_TOKEN)).rejects.toThrow("invalid_grant");
    expect(writes).toEqual([]);
  });
});

describe("a refresh that succeeds", () => {
  it("never touches the account marker and stores the rotated refresh token", async () => {
    const { database, writes } = createDatabaseStub({
      storedRefreshToken: FAILED_REFRESH_TOKEN,
    });
    const refresh = buildRefresher(database, () =>
      Promise.resolve({
        access_token: "fresh-access-token",
        expires_in: 3600,
        refresh_token: "rotated-refresh-token",
      }));

    await refresh(FAILED_REFRESH_TOKEN);

    expect(writes).toHaveLength(1);
    expect(writes[0]?.table).toBe("oauth_credentials");
    expect(writes[0]?.values.refreshToken).toBe("rotated-refresh-token");
  });

  it("keeps the supplied refresh token when the provider omits a rotated one", async () => {
    const { database, writes } = createDatabaseStub({
      storedRefreshToken: FAILED_REFRESH_TOKEN,
    });
    const refresh = buildRefresher(database, () =>
      Promise.resolve({ access_token: "fresh-access-token", expires_in: 3600 }));

    await refresh(FAILED_REFRESH_TOKEN);

    expect(writes[0]?.values.refreshToken).toBe(FAILED_REFRESH_TOKEN);
  });
});
