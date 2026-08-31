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

const residueWithoutAProviderAccountId = (): TeardownResidueRecord => ({
  accountEmail: "old-name@gmail.com",
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

const insertSurvivorCredential = async (email: string | null): Promise<void> => {
  await client.query(
    `insert into "user" ("email", "id", "name") values ('survivor@keeper.sh', 'survivor', 'Survivor')`,
  );
  await client.query(
    `insert into oauth_credentials ("accessToken", "email", "expiresAt", "provider", "refreshToken", "userId")
     values ('survivor-access', $1, now() + interval '1 hour', 'google', 'survivor-refresh', 'survivor')`,
    [email],
  );
};

describe("a renamed account email does not make a surviving grant revocable", () => {
  beforeEach(async () => {
    await client.exec(`drop table if exists oauth_credentials, "user" cascade;`);
    await client.exec(DDL);
  });

  it("refuses to resolve the identity when no provider account id pins either side", async () => {
    await insertSurvivorCredential("new-name@gmail.com");

    const census = await countSurvivingAccountLinks(database, residueWithoutAProviderAccountId());

    expect({
      blocked: census.blockingCredentialIds.length,
      identityResolved: census.identityResolved,
    }).toEqual({ blocked: 1, identityResolved: false });
  });

  it("still refuses to resolve the identity for a credential carrying no email at all", async () => {
    await insertSurvivorCredential(null);

    const census = await countSurvivingAccountLinks(database, residueWithoutAProviderAccountId());

    expect({
      blocked: census.blockingCredentialIds.length,
      identityResolved: census.identityResolved,
    }).toEqual({ blocked: 1, identityResolved: false });
  });
});
