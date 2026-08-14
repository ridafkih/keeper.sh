import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import { eq } from "drizzle-orm";
import { calendarAccountsTable, oauthCredentialsTable } from "@keeper.sh/database/schema";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCoordinatedRefresher } from "../../../src/core/oauth/coordinated-refresher";

const administrativeUrl = process.env.KEEPER_TEST_DATABASE_URL;
const scratchName = `keeper_refresher_reconnect_${process.pid}`;
const USER_ID = "refresher-reconnect-user";
const OLD_REFRESH_TOKEN = "refresh-token-before-reconnect";
const RECONNECTED_REFRESH_TOKEN = "refresh-token-the-user-just-granted";

const scratchUrl = (): string => {
  const url = new URL(administrativeUrl ?? "postgres://localhost");
  url.pathname = `/${scratchName}`;
  return url.toString();
};

const withAdministrativeClient = async (statements: string[]): Promise<void> => {
  const client = new SQL(administrativeUrl ?? "postgres://localhost");
  try {
    for (const statement of statements) {
      await client.unsafe(statement);
    }
  } finally {
    await client.end();
  }
};

let client: SQL = new SQL(administrativeUrl ?? "postgres://localhost");
let database: ReturnType<typeof drizzle> = drizzle(client);

const seedAccount = async (): Promise<{ accountId: string; credentialId: string }> => {
  const [credential] = await database
    .insert(oauthCredentialsTable)
    .values({
      accessToken: "access-token-before-reconnect",
      email: "person@example.com",
      expiresAt: new Date(Date.now() - 60_000),
      provider: "google",
      refreshToken: OLD_REFRESH_TOKEN,
      userId: USER_ID,
    })
    .returning({ id: oauthCredentialsTable.id });
  if (!credential) {
    throw new Error("Failed to seed oauth credential");
  }
  const [account] = await database
    .insert(calendarAccountsTable)
    .values({
      authType: "oauth",
      needsReauthentication: true,
      oauthCredentialId: credential.id,
      provider: "google",
      userId: USER_ID,
    })
    .returning({ id: calendarAccountsTable.id });
  if (!account) {
    throw new Error("Failed to seed calendar account");
  }
  return { accountId: account.id, credentialId: credential.id };
};

const applyReconnect = async (credentialId: string): Promise<void> => {
  await database
    .update(oauthCredentialsTable)
    .set({
      accessToken: "access-token-the-user-just-granted",
      expiresAt: new Date(Date.now() + 3_600_000),
      needsReauthentication: false,
      refreshToken: RECONNECTED_REFRESH_TOKEN,
    })
    .where(eq(oauthCredentialsTable.id, credentialId));
  await database
    .update(calendarAccountsTable)
    .set({ needsReauthentication: false })
    .where(eq(calendarAccountsTable.oauthCredentialId, credentialId));
};

const readCredential = async (credentialId: string) => {
  const [row] = await database
    .select({
      accessToken: oauthCredentialsTable.accessToken,
      refreshToken: oauthCredentialsTable.refreshToken,
    })
    .from(oauthCredentialsTable)
    .where(eq(oauthCredentialsTable.id, credentialId))
    .limit(1);
  return row;
};

const readAccountFlag = async (accountId: string): Promise<boolean | undefined> => {
  const [row] = await database
    .select({ needsReauthentication: calendarAccountsTable.needsReauthentication })
    .from(calendarAccountsTable)
    .where(eq(calendarAccountsTable.id, accountId))
    .limit(1);
  return row?.needsReauthentication;
};

const truncate = async (): Promise<void> => {
  await client.unsafe(`
    truncate table calendars, calendar_accounts, oauth_credentials restart identity cascade
  `);
};

beforeAll(async () => {
  if (!administrativeUrl) {
    return;
  }

  await withAdministrativeClient([
    `drop database if exists "${scratchName}"`,
    `create database "${scratchName}"`,
  ]);

  const migrationScript = `${import.meta.dirname}/../../../../database/scripts/migrate.ts`;
  const migration = await Bun.$`bun ${migrationScript}`
    .env({ ...process.env, DATABASE_URL: scratchUrl() })
    .quiet()
    .nothrow();
  if (migration.exitCode !== 0) {
    throw new Error(`Migration failed: ${migration.stderr.toString()}`);
  }

  client = new SQL(scratchUrl());
  database = drizzle(client);

  await client.unsafe(`
    insert into "user" (id, email, name)
    values ('${USER_ID}', 'refresher-reconnect@example.com', 'Refresher Reconnect')
  `);
});

afterAll(async () => {
  if (!administrativeUrl) {
    return;
  }
  await client.end();
  await withAdministrativeClient([`drop database if exists "${scratchName}"`]);
});

const deadRefreshTokenError = (): Error =>
  Object.assign(new Error("Token refresh failed (400): invalid_grant"), {
    oauthReauthRequired: true,
  });

const withReconnectBeforeAccountWrite = (credentialId: string): BunSQLDatabase => ({
  update: (table: unknown) => ({
    set: (values: Record<string, unknown>) => ({
      where: async (condition: unknown) => {
        if (table === calendarAccountsTable) {
          await applyReconnect(credentialId);
        }
        return (database.update(table as typeof calendarAccountsTable)
          .set(values) as unknown as {
            where: (value: unknown) => Promise<unknown>;
          })
          .where(condition);
      },
    }),
  }),
}) as unknown as BunSQLDatabase;

describe.skipIf(!administrativeUrl)("a reconnect that lands while a dead refresh is being flagged", () => {
  it("leaves the freshly reconnected account unflagged", async () => {
    await truncate();
    const { accountId, credentialId } = await seedAccount();
    await database
      .update(calendarAccountsTable)
      .set({ needsReauthentication: false })
      .where(eq(calendarAccountsTable.id, accountId));

    const refresh = createCoordinatedRefresher({
      calendarAccountId: accountId,
      database: withReconnectBeforeAccountWrite(credentialId),
      oauthCredentialId: credentialId,
      refreshLockStore: null,
      rawRefresh: () => Promise.reject(deadRefreshTokenError()),
    });

    await expect(refresh(OLD_REFRESH_TOKEN)).rejects.toThrow("invalid_grant");

    expect(await readCredential(credentialId)).toMatchObject({
      refreshToken: RECONNECTED_REFRESH_TOKEN,
    });
    expect(await readAccountFlag(accountId)).toBe(false);
  });

  it("still flags the account when no reconnect touched the credential", async () => {
    await truncate();
    const { accountId, credentialId } = await seedAccount();
    await database
      .update(calendarAccountsTable)
      .set({ needsReauthentication: false })
      .where(eq(calendarAccountsTable.id, accountId));

    const refresh = createCoordinatedRefresher({
      calendarAccountId: accountId,
      database: database as unknown as BunSQLDatabase,
      oauthCredentialId: credentialId,
      refreshLockStore: null,
      rawRefresh: () => Promise.reject(deadRefreshTokenError()),
    });

    await expect(refresh(OLD_REFRESH_TOKEN)).rejects.toThrow("invalid_grant");

    expect(await readAccountFlag(accountId)).toBe(true);
  });
});

describe.skipIf(!administrativeUrl)("a token refresh that finishes after the user reconnected", () => {
  it("stores the refreshed token when nobody reconnected during the run", async () => {
    await truncate();
    const { accountId, credentialId } = await seedAccount();
    const refresh = createCoordinatedRefresher({
      calendarAccountId: accountId,
      database: database as unknown as BunSQLDatabase,
      oauthCredentialId: credentialId,
      refreshLockStore: null,
      rawRefresh: () => Promise.resolve({
        access_token: "access-token-from-refresh",
        expires_in: 3600,
      }),
    });

    await refresh(OLD_REFRESH_TOKEN);

    expect(await readCredential(credentialId)).toMatchObject({
      accessToken: "access-token-from-refresh",
      refreshToken: OLD_REFRESH_TOKEN,
    });
  });

  it("does not overwrite the credential the reconnect just granted", async () => {
    await truncate();
    const { accountId, credentialId } = await seedAccount();
    const refresh = createCoordinatedRefresher({
      calendarAccountId: accountId,
      database: database as unknown as BunSQLDatabase,
      oauthCredentialId: credentialId,
      refreshLockStore: null,
      rawRefresh: async () => {
        await applyReconnect(credentialId);
        return { access_token: "access-token-from-refresh", expires_in: 3600 };
      },
    });

    await refresh(OLD_REFRESH_TOKEN);

    expect(await readCredential(credentialId)).toMatchObject({
      refreshToken: RECONNECTED_REFRESH_TOKEN,
    });
    expect(await readAccountFlag(accountId)).toBe(false);
  });

  it("converges: replaying the stale refresh never resurrects the old grant", async () => {
    await truncate();
    const { accountId, credentialId } = await seedAccount();
    const refresh = createCoordinatedRefresher({
      calendarAccountId: accountId,
      database: database as unknown as BunSQLDatabase,
      oauthCredentialId: credentialId,
      refreshLockStore: null,
      rawRefresh: () => Promise.resolve({
        access_token: "access-token-from-refresh",
        expires_in: 3600,
      }),
    });
    await applyReconnect(credentialId);

    await refresh(OLD_REFRESH_TOKEN);
    await refresh(OLD_REFRESH_TOKEN);

    expect(await readCredential(credentialId)).toMatchObject({
      refreshToken: RECONNECTED_REFRESH_TOKEN,
    });
  });
});
