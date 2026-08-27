import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { OAUTH_GRANT_RESIDUE_KIND } from "@keeper.sh/calendar";
import type { TeardownResidueRecord } from "@keeper.sh/calendar";
import { countSurvivingAccountLinks } from "../../src/jobs/reap-teardown-residue";

const client = new PGlite();
const database = drizzle(client);

const RESIDUE_ID = "66666666-6666-6666-6666-666666666666";
const RESIDUE_ACCOUNT_ID = "999999999999999999999";
const UNRELATED_CREDENTIAL_ID = "77777777-7777-7777-7777-777777777777";

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
  accountEmail: "deleted@gmail.com",
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

const insertUnrelatedSurvivor = async (email: string | null): Promise<void> => {
  await client.query(
    `insert into "user" ("email", "id", "name") values ('z@keeper.sh', 'user-z', 'Survivor Z')`,
  );
  await client.query(
    `insert into oauth_credentials ("accessToken", "email", "expiresAt", "id", "provider", "refreshToken", "userId")
     values ('z-access', ${email === null ? "null" : `'${email}'`}, now() + interval '1 hour', '${UNRELATED_CREDENTIAL_ID}', 'google', 'z-refresh', 'user-z')`,
  );
};

const linkUnrelatedCredentialToCalendarAccount = async (
  accountId: string | null,
): Promise<void> => {
  await client.query(
    `insert into calendar_accounts ("accountId", "oauthCredentialId", "provider", "userId")
     values (${accountId === null ? "null" : `'${accountId}'`}, '${UNRELATED_CREDENTIAL_ID}', 'google', 'user-z')`,
  );
};

describe("a google credential linked to no calendar account does not block every revocation", () => {
  beforeEach(async () => {
    await client.exec(
      `drop table if exists calendar_accounts, "account", oauth_credentials, "user" cascade;`,
    );
    await client.exec(DDL);
  });

  it("resolves the identity when no credential survives at all", async () => {
    expect(await countSurvivingAccountLinks(database, oauthGrantResidue())).toEqual({
      coHolders: 0,
      identityResolved: true,
    });
  });

  it("resolves the identity when the only survivor is an unlinked null-email credential", async () => {
    await insertUnrelatedSurvivor(null);

    expect(await countSurvivingAccountLinks(database, oauthGrantResidue())).toEqual({
      coHolders: 0,
      identityResolved: true,
    });
  });

  it("still counts an unlinked credential whose email matches the residue account", async () => {
    await insertUnrelatedSurvivor("deleted@gmail.com");

    const census = await countSurvivingAccountLinks(database, oauthGrantResidue());

    expect(census.coHolders).toBeGreaterThanOrEqual(1);
    expect(census.identityResolved).toBe(true);
  });

  it("leaves the identity unresolved for a null-email credential whose calendar account row carries a null account id", async () => {
    await insertUnrelatedSurvivor(null);
    await linkUnrelatedCredentialToCalendarAccount(null);

    expect(await countSurvivingAccountLinks(database, oauthGrantResidue())).toEqual({
      coHolders: 0,
      identityResolved: false,
    });
  });
});
