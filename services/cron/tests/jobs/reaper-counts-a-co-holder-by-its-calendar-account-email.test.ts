import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { OAUTH_GRANT_RESIDUE_KIND } from "@keeper.sh/calendar";
import type { TeardownResidueRecord } from "@keeper.sh/calendar";
import { countSurvivingAccountLinks } from "../../src/jobs/reap-teardown-residue";

const client = new PGlite();
const database = drizzle(client);

const RESIDUE_ID = "66666666-6666-6666-6666-666666666666";
const SURVIVOR_CREDENTIAL_ID = "77777777-7777-7777-7777-777777777777";
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
  "email" text,
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

const insertSurvivorKnownOnlyByCalendarAccountEmail = async (): Promise<void> => {
  await client.query(
    `insert into "user" ("email", "id", "name") values ('b@keeper.sh', 'user-b', 'Survivor B')`,
  );
  await client.query(
    `insert into oauth_credentials ("accessToken", "email", "expiresAt", "id", "provider", "refreshToken", "userId")
     values ('b-access', '${STALE_ACCOUNT_EMAIL}', now() + interval '1 hour', '${SURVIVOR_CREDENTIAL_ID}', 'google', 'b-refresh', 'user-b')`,
  );
  await client.query(
    `insert into calendar_accounts ("accountId", "email", "oauthCredentialId", "provider", "userId")
     values (null, '${RENAMED_ACCOUNT_EMAIL}', '${SURVIVOR_CREDENTIAL_ID}', 'google', 'user-b')`,
  );
};

describe("the census counts a co-holder by its calendar account email", () => {
  beforeEach(async () => {
    await client.exec(
      `drop table if exists calendar_accounts, "account", oauth_credentials, "user" cascade;`,
    );
    await client.exec(DDL);
  });

  it("counts a null-account-id calendar row whose email matches the residue account email", async () => {
    await insertSurvivorKnownOnlyByCalendarAccountEmail();

    const surviving = await countSurvivingAccountLinks(
      database,
      oauthGrantResidue(),
    );

    expect(surviving.coHolders).toBeGreaterThanOrEqual(1);
  });

  it("matches the calendar account email case-insensitively", async () => {
    await client.query(
      `insert into "user" ("email", "id", "name") values ('c@keeper.sh', 'user-c', 'Survivor C')`,
    );
    await client.query(
      `insert into oauth_credentials ("accessToken", "email", "expiresAt", "id", "provider", "refreshToken", "userId")
       values ('c-access', '${STALE_ACCOUNT_EMAIL}', now() + interval '1 hour', '88888888-8888-8888-8888-888888888888', 'google', 'c-refresh', 'user-c')`,
    );
    await client.query(
      `insert into calendar_accounts ("accountId", "email", "oauthCredentialId", "provider", "userId")
       values (null, 'NEW-NAME@Workspace.Example', '88888888-8888-8888-8888-888888888888', 'google', 'user-c')`,
    );

    const surviving = await countSurvivingAccountLinks(
      database,
      oauthGrantResidue(),
    );

    expect(surviving.coHolders).toBeGreaterThanOrEqual(1);
  });
});
