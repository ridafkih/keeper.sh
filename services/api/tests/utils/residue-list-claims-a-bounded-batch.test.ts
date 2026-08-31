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
const BATCH_LIMIT = 2;
const DELETED_USER_IDS = ["gone-one", "gone-two", "gone-three"];

const residueStore = createTeardownResidueStore({
  batchLimit: BATCH_LIMIT,
  database,
  encryptionKey: ENCRYPTION_KEY,
  now: () => CLAIMED_AT,
});

const recordGrantResidue = async (userId: string): Promise<void> => {
  await residueStore.record({
    credential: {
      accessToken: `${userId}-token`,
      expiresAt: new Date("2026-08-26T07:00:00.000Z"),
      refreshToken: `${userId}-refresh`,
    },
    kind: OAUTH_GRANT_RESIDUE_KIND,
    provider: "google",
    userId,
  });
};

interface ResidueBackoffRow {
  attempts: number;
  nextAttemptAt: Date | null;
  userId: string;
}

const readUnclaimedRows = async (claimedUserIds: string[]): Promise<ResidueBackoffRow[]> => {
  const rows = await client.query<ResidueBackoffRow>(
    `select "attempts", "nextAttemptAt", "userId" from deletion_residue where not ("userId" = any($1))`,
    [claimedUserIds],
  );

  return rows.rows;
};

describe("claiming teardown residue in bounded batches", () => {
  beforeEach(async () => {
    await client.exec(`drop table if exists deletion_residue, "user" cascade;`);
    await client.exec(DDL);
    for (const userId of DELETED_USER_IDS) {
      await recordGrantResidue(userId);
    }
  });

  it("claims at most the configured batch size in one call", async () => {
    const claimed = await residueStore.list();

    expect(claimed).toHaveLength(BATCH_LIMIT);
  });

  it("leaves rows beyond the batch unclaimed with their attempts and backoff untouched", async () => {
    const claimed = await residueStore.list();
    const unclaimed = await readUnclaimedRows(claimed.map((record) => record.userId));

    expect(unclaimed).toHaveLength(DELETED_USER_IDS.length - BATCH_LIMIT);
    expect(unclaimed[0]).toMatchObject({ attempts: 0, nextAttemptAt: null });
  });

  it("claims the remaining row on the following call", async () => {
    const firstBatch = await residueStore.list();
    const secondBatch = await residueStore.list();

    expect(secondBatch).toHaveLength(DELETED_USER_IDS.length - BATCH_LIMIT);
    expect(firstBatch.map((record) => record.userId)).not.toContain(
      secondBatch[0]?.userId,
    );
  });
});
