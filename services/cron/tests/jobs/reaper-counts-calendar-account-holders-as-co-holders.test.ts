import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { OAUTH_GRANT_RESIDUE_KIND } from "@keeper.sh/calendar";
import type { TeardownResidueRecord } from "@keeper.sh/calendar";
import { countSurvivingAccountLinks } from "../../src/jobs/reap-teardown-residue";

const client = new PGlite();
const database = drizzle(client);

const RESIDUE_ID = "44444444-4444-4444-4444-444444444444";
const SHARED_ACCOUNT_ID = "google-sub-shared";
const RENAMED_ACCOUNT_EMAIL = "new-name@workspace.example";
const STALE_ACCOUNT_EMAIL = "old-name@workspace.example";

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
create table "account" (
  "accessToken" text,
  "accessTokenExpiresAt" timestamptz,
  "accountId" text not null,
  "createdAt" timestamptz not null default now(),
  "id" text primary key,
  "idToken" text,
  "password" text,
  "providerId" text not null,
  "refreshToken" text,
  "refreshTokenExpiresAt" timestamptz,
  "scope" text,
  "updatedAt" timestamptz not null default now(),
  "userId" text not null references "user"("id") on delete cascade
);
create table calendar_accounts (
  "accountId" text,
  "id" uuid primary key default gen_random_uuid(),
  "oauthCredentialId" uuid references oauth_credentials("id") on delete cascade,
  "provider" text not null,
  "userId" text not null references "user"("id") on delete cascade
);
`;

const oauthGrantResidue = (): TeardownResidueRecord => ({
  accountEmail: RENAMED_ACCOUNT_EMAIL,
  createdAt: new Date("2026-08-26T11:00:00.000Z"),
  credential: {
    accessToken: "a-access",
    expiresAt: new Date("2026-08-26T13:00:00.000Z"),
    refreshToken: "a-refresh",
  },
  expiresAt: new Date("2026-09-30T12:00:00.000Z"),
  id: RESIDUE_ID,
  kind: OAUTH_GRANT_RESIDUE_KIND,
  provider: "google",
  providerAccountId: SHARED_ACCOUNT_ID,
  userId: "user-a",
});

const insertSurvivorHoldingTheAccountUnderItsOldName =
  async (): Promise<void> => {
    await client.query(
      `insert into "user" ("email", "id", "name") values ('b@keeper.sh', 'user-b', 'Survivor B')`,
    );
    await client.query(
      `insert into oauth_credentials ("accessToken", "email", "expiresAt", "id", "provider", "refreshToken", "userId")
       values ('b-access', '${STALE_ACCOUNT_EMAIL}', now() + interval '1 hour', '55555555-5555-5555-5555-555555555555', 'google', 'b-refresh', 'user-b')`,
    );
    await client.query(
      `insert into calendar_accounts ("accountId", "oauthCredentialId", "provider", "userId")
       values ('${SHARED_ACCOUNT_ID}', '55555555-5555-5555-5555-555555555555', 'google', 'user-b')`,
    );
  };

describe("a surviving calendar account row counts as a co-holder of the grant", () => {
  beforeEach(async () => {
    await client.exec(
      `drop table if exists calendar_accounts, "account", oauth_credentials, "user" cascade;`,
    );
    await client.exec(DDL);
  });

  it("counts the holder whose credential row still records the pre-rename email", async () => {
    await insertSurvivorHoldingTheAccountUnderItsOldName();

    const surviving = await countSurvivingAccountLinks(
      database,
      oauthGrantResidue(),
    );

    expect(surviving.coHolders).toBeGreaterThanOrEqual(1);
  });

  it("still counts zero when no calendar account row holds the provider account", async () => {
    expect(
      await countSurvivingAccountLinks(database, oauthGrantResidue()),
    ).toEqual({ coHolders: 0, identityResolved: true });
  });
});
