import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

const client = new PGlite();
const database = drizzle(client);

vi.mock("@/context", () => ({
  database,
  encryptionKey: "encryption-key",
  oauthProviders: {
    getProvider: () => null,
    hasRequiredScopes: () => true,
    isOAuthProvider: () => true,
  },
  premiumService: {
    canAddAccount: () => Promise.resolve(true),
    getAccountLimit: () => 10,
    getUserPlan: () => Promise.resolve("pro"),
  },
}));

vi.mock("@/utils/logging", () => ({
  widelog: {
    error: () => null,
    errorFields: () => null,
    set: () => null,
  },
}));

vi.mock("@keeper.sh/calendar/google", () => ({
  listUserCalendars: () => Promise.resolve([]),
}));

vi.mock("@keeper.sh/calendar/outlook", () => ({
  listUserCalendars: () => Promise.resolve([]),
}));

const { adoptProviderAccountIdWithDatabase } = await import("../../src/utils/oauth-sources");

const DDL = `
create table oauth_credentials (
  "id" uuid primary key default gen_random_uuid(),
  "accessToken" text not null,
  "createdAt" timestamptz not null default now(),
  "email" text,
  "expiresAt" timestamptz not null,
  "needsReauthentication" boolean not null default false,
  "provider" text not null,
  "refreshToken" text not null,
  "updatedAt" timestamptz not null default now(),
  "userId" text not null
);
create table calendar_accounts (
  "id" uuid primary key default gen_random_uuid(),
  "accountId" text,
  "authType" text not null,
  "caldavCredentialId" uuid,
  "calendarsRefreshAttemptedAt" timestamptz,
  "calendarsRefreshedAt" timestamptz,
  "createdAt" timestamptz not null default now(),
  "displayName" text,
  "email" text,
  "needsReauthentication" boolean not null default false,
  "oauthCredentialId" uuid,
  "provider" text not null,
  "reauthenticationSource" text,
  "updatedAt" timestamptz not null default now(),
  "userId" text not null
);
create unique index "calendar_accounts_provider_account_idx"
  on "calendar_accounts" ("userId", "provider", "accountId");
`;

const USER_ID = "user-1";
const PROVIDER_ACCOUNT_ID = "123";
const EXPIRES_AT = new Date("2027-01-01T00:00:00.000Z");

const seedIdentitylessAccount = async (email: string): Promise<string> => {
  const credential = await client.query<{ id: string }>(
    `insert into oauth_credentials
       ("accessToken", "email", "expiresAt", "provider", "refreshToken", "userId")
     values ('access', $1, $2, 'google', 'refresh', $3)
     returning "id"`,
    [email, EXPIRES_AT, USER_ID],
  );
  const credentialId = credential.rows[0]?.id;
  if (!credentialId) {
    throw new Error("Failed to seed an OAuth credential");
  }

  const account = await client.query<{ id: string }>(
    `insert into calendar_accounts
       ("authType", "email", "oauthCredentialId", "provider", "userId")
     values ('oauth', $1, $2, 'google', $3)
     returning "id"`,
    [email, credentialId, USER_ID],
  );
  const accountRowId = account.rows[0]?.id;
  if (!accountRowId) {
    throw new Error("Failed to seed a calendar account");
  }

  return accountRowId;
};

const readAccount = async (accountRowId: string) => {
  const result = await client.query<{ accountId: string | null; displayName: string | null }>(
    `select "accountId", "displayName" from calendar_accounts where "id" = $1`,
    [accountRowId],
  );
  const [row] = result.rows;
  if (!row) {
    throw new Error("Seeded calendar account row disappeared");
  }
  return row;
};

describe("the connect path adopting a provider account id a sibling row already holds", () => {
  beforeEach(async () => {
    await client.exec(`drop table if exists calendar_accounts, oauth_credentials cascade;`);
    await client.exec(DDL);
  });

  it("declines the sibling-claimed identity and leaves the connect transaction usable", async () => {
    const siblingRowId = await seedIdentitylessAccount("sibling@example.com");
    const connectingRowId = await seedIdentitylessAccount("connecting@example.com");

    await client.query(`update calendar_accounts set "accountId" = $1 where "id" = $2`, [
      PROVIDER_ACCOUNT_ID,
      siblingRowId,
    ]);

    await database.transaction(async (transaction) => {
      await adoptProviderAccountIdWithDatabase(transaction, {
        accountRowId: connectingRowId,
        providerAccountId: PROVIDER_ACCOUNT_ID,
      });

      await transaction.execute(
        sql`update calendar_accounts set "displayName" = 'source added' where "id" = ${connectingRowId}::uuid`,
      );
    });

    const connecting = await readAccount(connectingRowId);
    const sibling = await readAccount(siblingRowId);
    expect(connecting.accountId).toBeNull();
    expect(connecting.displayName).toBe("source added");
    expect(sibling.accountId).toBe(PROVIDER_ACCOUNT_ID);
  });

  it("adopts the identity when no sibling row holds it", async () => {
    const connectingRowId = await seedIdentitylessAccount("connecting@example.com");

    await adoptProviderAccountIdWithDatabase(database, {
      accountRowId: connectingRowId,
      providerAccountId: PROVIDER_ACCOUNT_ID,
    });

    const connecting = await readAccount(connectingRowId);
    expect(connecting.accountId).toBe(PROVIDER_ACCOUNT_ID);
  });
});
