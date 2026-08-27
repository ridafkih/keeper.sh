import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { OAUTH_GRANT_RESIDUE_KIND } from "@keeper.sh/calendar";
import type { TeardownResidueRecord } from "@keeper.sh/calendar";
import { countSurvivingAccountLinks } from "../../src/jobs/reap-teardown-residue";

const client = new PGlite();
const database = drizzle(client);

const RESIDUE_ID = "88888888-8888-8888-8888-888888888888";
const RESIDUE_ACCOUNT_EMAIL = "deleted-person@example.com";
const RESIDUE_ACCOUNT_ID = "sub-one";
const STRANGER_CREDENTIAL_ID = "99999999-9999-9999-9999-999999999999";

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
  providerAccountId: RESIDUE_ACCOUNT_ID,
  userId: "user-a",
});

const insertStranger = async (
  credentialEmail: string | null,
  calendarEmail: string,
): Promise<void> => {
  const credentialEmailLiteral =
    credentialEmail === null ? "null" : `'${credentialEmail}'`;

  await client.query(
    `insert into "user" ("email", "id", "name") values ('stranger@keeper.sh', 'user-stranger', 'Stranger')`,
  );
  await client.query(
    `insert into oauth_credentials ("accessToken", "email", "expiresAt", "id", "provider", "refreshToken", "userId")
     values ('s-access', ${credentialEmailLiteral}, now() + interval '1 hour', '${STRANGER_CREDENTIAL_ID}', 'google', 's-refresh', 'user-stranger')`,
  );
  await client.query(
    `insert into calendar_accounts ("accountId", "email", "oauthCredentialId", "provider", "userId")
     values (null, '${calendarEmail}', '${STRANGER_CREDENTIAL_ID}', 'google', 'user-stranger')`,
  );
};

describe("a credential whose calendar row names a different account does not block another account's residue", () => {
  beforeEach(async () => {
    await client.exec(
      `drop table if exists calendar_accounts, "account", oauth_credentials, "user" cascade;`,
    );
    await client.exec(DDL);
  });

  it("resolves the census when the stranger's calendar row names a different account email", async () => {
    await insertStranger(null, "stranger@keeper.sh");

    expect(await countSurvivingAccountLinks(database, oauthGrantResidue())).toEqual({
      coHolders: 0,
      identityResolved: true,
    });
  });

  it("resolves the census when the stranger's credential email and calendar email both differ", async () => {
    await insertStranger("stranger@gmail.com", "stranger-calendar@keeper.sh");

    expect(await countSurvivingAccountLinks(database, oauthGrantResidue())).toEqual({
      coHolders: 0,
      identityResolved: true,
    });
  });

  it("still blocks when the stranger's row carries no identity signal at all", async () => {
    await client.query(
      `insert into "user" ("email", "id", "name") values ('stranger@keeper.sh', 'user-stranger', 'Stranger')`,
    );
    await client.query(
      `insert into oauth_credentials ("accessToken", "email", "expiresAt", "id", "provider", "refreshToken", "userId")
       values ('s-access', null, now() + interval '1 hour', '${STRANGER_CREDENTIAL_ID}', 'google', 's-refresh', 'user-stranger')`,
    );
    await client.query(
      `insert into calendar_accounts ("accountId", "email", "oauthCredentialId", "provider", "userId")
       values (null, null, '${STRANGER_CREDENTIAL_ID}', 'google', 'user-stranger')`,
    );

    expect(await countSurvivingAccountLinks(database, oauthGrantResidue())).toEqual({
      coHolders: 0,
      identityResolved: false,
    });
  });
});
