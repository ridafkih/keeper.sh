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
const CLAIMED_AT = new Date("2026-08-26T06:15:33.956Z");

const residueStore = createTeardownResidueStore({
  database,
  encryptionKey: ENCRYPTION_KEY,
  now: () => CLAIMED_AT,
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

interface ResidueBackoffRow {
  attempts: number;
  nextAttemptAt: Date | null;
}

const readBackoff = async (userId: string): Promise<ResidueBackoffRow> => {
  const rows = await client.query<ResidueBackoffRow>(
    `select "attempts", "nextAttemptAt" from deletion_residue where "userId" = $1`,
    [userId],
  );
  const [row] = rows.rows;
  if (!row) {
    throw new Error(`No residue row remained for ${userId}`);
  }

  return row;
};

describe("claiming teardown residue", () => {
  beforeEach(async () => {
    await client.exec(`drop table if exists deletion_residue, "user" cascade;`);
    await client.exec(DDL);
    await client.query(
      `insert into "user" ("email", "id", "name") values ('still-here@example.com', 'still-here', 'Still Here')`,
    );
    await recordGrantResidue("still-here", "live-customer-token");
    await recordGrantResidue("already-gone", "deleted-user-token");
  });

  it("claims only residue whose user row is gone", async () => {
    const claimed = await residueStore.list();

    expect(claimed.map((record) => record.userId)).toEqual(["already-gone"]);
  });

  it("leaves a surviving user's residue unclaimed instead of burning an attempt", async () => {
    await residueStore.list();

    expect(await readBackoff("still-here")).toMatchObject({
      attempts: 0,
      nextAttemptAt: null,
    });
  });
});
