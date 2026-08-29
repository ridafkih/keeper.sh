import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { sweepOrphanedOAuthCredentials } from "../../src/jobs/reap-teardown-residue";

const client = new PGlite();
const database = drizzle(client);

const NOW = new Date("2026-08-26T12:00:00.000Z");
const SAFETY_AGE_MS = 60 * 60 * 1000;

const STALE_ORPHAN_EMAIL = "stale-orphan@workspace.example";
const FRESH_ORPHAN_EMAIL = "fresh-orphan@workspace.example";
const LINKED_EMAIL = "linked@workspace.example";
const STALE_OUTLOOK_ORPHAN_EMAIL = "stale-orphan@outlook.example";

const DDL = `
create table "user" (
  "createdAt" timestamptz not null default now(),
  "email" text not null unique,
  "emailVerified" boolean not null default false,
  "id" text primary key,
  "image" text,
  "name" text not null,
  "updatedAt" timestamptz not null default now(),
  "username" text unique
);
create table oauth_credentials (
  "accessToken" text not null,
  "createdAt" timestamptz not null default now(),
  "email" text,
  "expiresAt" timestamptz not null,
  "id" uuid primary key default gen_random_uuid(),
  "needsReauthentication" boolean not null default false,
  "provider" text not null,
  "refreshToken" text not null,
  "updatedAt" timestamptz not null default now(),
  "userId" text not null references "user"("id") on delete cascade
);
create table calendar_accounts (
  "accountId" text,
  "email" text,
  "id" uuid primary key default gen_random_uuid(),
  "oauthCredentialId" uuid references oauth_credentials("id") on delete cascade,
  "provider" text not null,
  "userId" text not null references "user"("id") on delete cascade
);
`;

const insertCredential = async (
  email: string,
  provider: string,
  createdAt: string,
): Promise<string> => {
  const result = await client.query<{ id: string }>(
    `insert into oauth_credentials ("accessToken", "createdAt", "email", "expiresAt", "provider", "refreshToken", "userId")
     values ('access', $1, $2, timestamptz '2026-08-26T13:00:00.000Z', $3, 'refresh', 'user-a')
     returning "id"`,
    [createdAt, email, provider],
  );

  const [row] = result.rows;

  if (!row) {
    throw new Error(`Seeding the ${provider} credential for ${email} returned no row`);
  }

  return row.id;
};

const remainingCredentialEmails = async (): Promise<string[]> => {
  const result = await client.query<{ email: string }>(
    `select "email" from oauth_credentials order by "email"`,
  );

  return result.rows.map((row) => row.email);
};

describe("orphan oauth credentials are swept", () => {
  beforeEach(async () => {
    await client.exec(`drop table if exists calendar_accounts, oauth_credentials, "user" cascade;`);
    await client.exec(DDL);
    await client.query(
      `insert into "user" ("email", "id", "name") values ('user-a@keeper.sh', 'user-a', 'User A')`,
    );
  });

  it("deletes a google credential that backs no calendar account and is older than the safety age", async () => {
    await insertCredential(STALE_ORPHAN_EMAIL, "google", "2026-08-24T12:00:00.000Z");
    await insertCredential(FRESH_ORPHAN_EMAIL, "google", "2026-08-26T11:59:00.000Z");

    const linkedId = await insertCredential(LINKED_EMAIL, "google", "2026-08-24T12:00:00.000Z");
    await client.query(
      `insert into calendar_accounts ("accountId", "email", "oauthCredentialId", "provider", "userId")
       values (null, $1, $2, 'google', 'user-a')`,
      [LINKED_EMAIL, linkedId],
    );

    await sweepOrphanedOAuthCredentials({
      database,
      minimumAgeMs: SAFETY_AGE_MS,
      now: () => NOW,
    });

    expect(await remainingCredentialEmails()).toEqual([FRESH_ORPHAN_EMAIL, LINKED_EMAIL]);
  });

  it("sweeps a stale outlook orphan on the same pass", async () => {
    await insertCredential(STALE_OUTLOOK_ORPHAN_EMAIL, "outlook", "2026-08-24T12:00:00.000Z");
    await insertCredential(FRESH_ORPHAN_EMAIL, "google", "2026-08-26T11:59:00.000Z");

    await sweepOrphanedOAuthCredentials({
      database,
      minimumAgeMs: SAFETY_AGE_MS,
      now: () => NOW,
    });

    expect(await remainingCredentialEmails()).toEqual([FRESH_ORPHAN_EMAIL]);
  });
});
