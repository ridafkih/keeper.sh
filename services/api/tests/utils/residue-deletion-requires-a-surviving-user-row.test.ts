import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { OAUTH_GRANT_RESIDUE_KIND, createTeardownResidueStore } from "@keeper.sh/calendar";

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
create table deletion_residue (
  "accountEmail" text,
  "attempts" integer not null default 0,
  "createdAt" timestamptz not null default now(),
  "credentialExpiresAt" timestamptz,
  "encryptedAccessToken" text,
  "encryptedRefreshToken" text,
  "expiresAt" timestamptz not null,
  "externalId" text,
  "id" uuid primary key default gen_random_uuid(),
  "kind" text not null,
  "lastAttemptAt" timestamptz,
  "nextAttemptAt" timestamptz,
  "provider" text,
  "providerAccountId" text,
  "providerChannelId" text,
  "providerResourceId" text,
  "userId" text not null
);
`;

const ENCRYPTION_KEY = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=";
const RECORDED_AT = new Date("2026-08-26T06:15:33.956Z");

const residueStore = createTeardownResidueStore({
  database,
  encryptionKey: ENCRYPTION_KEY,
  now: () => RECORDED_AT,
});

const recordGrantResidue = async (userId: string, accessToken: string): Promise<void> => {
  await residueStore.record({
    credential: {
      accessToken,
      expiresAt: new Date("2026-08-26T07:00:00.000Z"),
      refreshToken: `${accessToken}-refresh`,
    },
    kind: OAUTH_GRANT_RESIDUE_KIND,
    provider: "google",
    userId,
  });
};

const countResidue = async (userId: string): Promise<number> => {
  const rows = await client.query<{ total: string }>(
    `select count(*)::text as total from deletion_residue where "userId" = $1`,
    [userId],
  );
  const [row] = rows.rows;
  if (!row) {
    throw new Error(`Counting residue for ${userId} returned no row`);
  }

  return Number(row.total);
};

describe("discarding teardown residue on rollback", () => {
  beforeEach(async () => {
    await client.exec(`drop table if exists deletion_residue, "user" cascade;`);
    await client.exec(DDL);
    await client.query(
      `insert into "user" ("email", "id", "name") values ('still-here@example.com', 'still-here', 'Still Here')`,
    );
    await recordGrantResidue("still-here", "live-customer-token");
    await recordGrantResidue("user-gone", "deleted-user-token");
  });

  it("keeps residue for a user whose row is already gone", async () => {
    const deleted = await residueStore.deleteForUser("user-gone", OAUTH_GRANT_RESIDUE_KIND);

    expect(deleted).toBe(0);
    expect(await countResidue("user-gone")).toBe(1);
  });

  it("clears residue for a user whose row survived the failed delete", async () => {
    const deleted = await residueStore.deleteForUser("still-here", OAUTH_GRANT_RESIDUE_KIND);

    expect(deleted).toBe(1);
    expect(await countResidue("still-here")).toBe(0);
  });
});
