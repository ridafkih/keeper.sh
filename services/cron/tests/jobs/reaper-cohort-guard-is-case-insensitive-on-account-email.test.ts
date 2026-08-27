import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { OAUTH_GRANT_RESIDUE_KIND } from "@keeper.sh/calendar";
import type { TeardownResidueRecord } from "@keeper.sh/calendar";
import { countSurvivingAccountLinks } from "../../src/jobs/reap-teardown-residue";

const client = new PGlite();
const database = drizzle(client);

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
`;

const residueFor = (accountEmail: string): TeardownResidueRecord => ({
  accountEmail,
  credential: {
    accessToken: "deleted-user-access",
    expiresAt: new Date("2026-08-26T07:00:00.000Z"),
    refreshToken: "deleted-user-refresh",
  },
  id: "11111111-1111-1111-1111-111111111111",
  kind: OAUTH_GRANT_RESIDUE_KIND,
  provider: "google",
  userId: "deleted-user",
});

const insertSurvivor = async (email: string): Promise<void> => {
  await client.query(
    `insert into "user" ("email", "id", "name") values ('survivor@keeper.sh', 'survivor', 'Survivor')`,
  );
  await client.query(
    `insert into oauth_credentials ("accessToken", "email", "expiresAt", "provider", "refreshToken", "userId")
     values ('survivor-access', $1, now() + interval '1 hour', 'google', 'survivor-refresh', 'survivor')`,
    [email],
  );
};

describe("counting co-holders of a google account behind oauth grant residue", () => {
  beforeEach(async () => {
    await client.exec(`drop table if exists oauth_credentials, "user" cascade;`);
    await client.exec(DDL);
  });

  it("counts a surviving row whose email matches only case-insensitively", async () => {
    await insertSurvivor("Bob@Gmail.com");

    expect(
      await countSurvivingAccountLinks(database, residueFor("bob@gmail.com")),
    ).toEqual({
      blockingCredentialIds: [],
      coHolders: 1,
      identityResolved: true,
    });
  });

  it("counts a surviving row whose email matches exactly", async () => {
    await insertSurvivor("bob@gmail.com");

    expect(
      await countSurvivingAccountLinks(database, residueFor("bob@gmail.com")),
    ).toEqual({
      blockingCredentialIds: [],
      coHolders: 1,
      identityResolved: true,
    });
  });

  it("counts no co-holder when the surviving row is a different account", async () => {
    await insertSurvivor("someone-else@gmail.com");

    expect(
      await countSurvivingAccountLinks(database, residueFor("bob@gmail.com")),
    ).toEqual({
      blockingCredentialIds: [],
      coHolders: 0,
      identityResolved: true,
    });
  });
});
