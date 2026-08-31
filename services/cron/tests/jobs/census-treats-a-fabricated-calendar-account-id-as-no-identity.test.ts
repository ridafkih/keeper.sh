import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { OAUTH_GRANT_RESIDUE_KIND } from "@keeper.sh/calendar";
import type { TeardownResidueRecord } from "@keeper.sh/calendar";
import { countSurvivingAccountLinks } from "../../src/jobs/reap-teardown-residue";

const client = new PGlite();
const database = drizzle(client);

const RESIDUE_ID = "66666666-6666-6666-6666-666666666666";
const SURVIVOR_CREDENTIAL_ID = "55555555-5555-5555-5555-555555555555";
const SURVIVOR_CALENDAR_ACCOUNT_ID = "77777777-7777-7777-7777-777777777777";
const SHARED_ACCOUNT_ID = "google-sub-shared";
const RESIDUE_ACCOUNT_EMAIL = "renamed@example.com";
const STALE_ACCOUNT_EMAIL = "old-address@example.com";

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
  "email" text,
  "id" uuid primary key default gen_random_uuid(),
  "oauthCredentialId" uuid references oauth_credentials("id") on delete cascade,
  "provider" text not null,
  "userId" text not null references "user"("id") on delete cascade
);
`;

const oauthGrantResidue = (): TeardownResidueRecord => ({
  accountEmail: RESIDUE_ACCOUNT_EMAIL,
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

const insertSurvivor = async (calendarAccountId: string): Promise<void> => {
  await client.query(
    `insert into "user" ("email", "id", "name") values ('survivor@keeper.sh', 'user-b', 'Survivor')`,
  );
  await client.query(
    `insert into oauth_credentials ("accessToken", "email", "expiresAt", "id", "provider", "refreshToken", "userId")
     values ('b-access', '${STALE_ACCOUNT_EMAIL}', now() + interval '1 hour', '${SURVIVOR_CREDENTIAL_ID}', 'google', 'b-refresh', 'user-b')`,
  );
  await client.query(
    `insert into calendar_accounts ("accountId", "email", "id", "oauthCredentialId", "provider", "userId")
     values ('${calendarAccountId}', '${STALE_ACCOUNT_EMAIL}', '${SURVIVOR_CALENDAR_ACCOUNT_ID}', '${SURVIVOR_CREDENTIAL_ID}', 'google', 'user-b')`,
  );
};

describe("a calendar account id fabricated from the row's own id carries no provider identity", () => {
  beforeEach(async () => {
    await client.exec(
      `drop table if exists calendar_accounts, "account", oauth_credentials, "user" cascade;`,
    );
    await client.exec(DDL);
  });

  it("defers when the survivor's calendar row names itself as the provider account", async () => {
    await insertSurvivor(SURVIVOR_CALENDAR_ACCOUNT_ID);

    expect(await countSurvivingAccountLinks(database, oauthGrantResidue())).toEqual({
      blockingCredentialIds: [SURVIVOR_CREDENTIAL_ID],
      coHolders: 0,
      identityResolved: false,
    });
  });

  it("resolves when the survivor's calendar row names a genuinely different provider account", async () => {
    await insertSurvivor("google-sub-other");

    expect(await countSurvivingAccountLinks(database, oauthGrantResidue())).toEqual({
      blockingCredentialIds: [],
      coHolders: 0,
      identityResolved: true,
    });
  });
});
