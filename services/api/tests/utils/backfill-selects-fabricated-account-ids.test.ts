import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it, vi } from "vitest";

const client = new PGlite();
const database = drizzle(client);

vi.mock("@/context", () => ({
  database,
  oauthProviders: {
    getProvider: () => null,
  },
}));

vi.mock("@/utils/logging", () => ({
  context: (callback: () => Promise<void>) => callback(),
  destroy: () => Promise.resolve(),
  widelog: {
    error: () => null,
    errorFields: () => null,
    flush: () => null,
    set: () => null,
  },
}));

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
`;

await client.exec(DDL);

const { selectCandidates } = await import("../../src/scripts/backfill-provider-account-ids");

const USER_ID = "user-1";
const EXPIRES_AT = new Date("2027-01-01T00:00:00.000Z");

const seedAccount = async (email: string): Promise<string> => {
  const credential = await client.query<{ id: string }>(
    `insert into oauth_credentials
       ("accessToken", "email", "expiresAt", "provider", "refreshToken", "userId")
     values ('source-access', $1, $2, 'google', 'source-refresh', $3)
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

const setAccountId = async (accountRowId: string, accountId: string): Promise<void> => {
  await client.query(`update calendar_accounts set "accountId" = $1 where "id" = $2`, [
    accountId,
    accountRowId,
  ]);
};

describe("the provider account id backfill candidate selection", () => {
  it("reaches rows whose accountId was fabricated from the row's own id", async () => {
    const missing = await seedAccount("missing@example.com");

    const fabricated = await seedAccount("fabricated@example.com");
    await setAccountId(fabricated, fabricated);

    const genuine = await seedAccount("genuine@example.com");
    await setAccountId(genuine, "google-sub-real");

    const candidates = await selectCandidates();

    expect(candidates.map((candidate) => candidate.accountRowId).toSorted()).toEqual(
      [missing, fabricated].toSorted(),
    );
  });
});
