import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import * as reapTeardownResidue from "../../src/jobs/reap-teardown-residue";
import { sweepOrphanedOAuthCredentials } from "../../src/jobs/reap-teardown-residue";

const client = new PGlite();
const database = drizzle(client);

const NOW = new Date("2026-08-26T12:00:00.000Z");
const SAFETY_AGE_MS = 60 * 60 * 1000;

const ORPHAN_CREDENTIAL_SWEEP_BATCH_LIMIT = 100;
const ORPHAN_OVERFLOW = 50;
const SEEDED_ORPHAN_COUNT = ORPHAN_CREDENTIAL_SWEEP_BATCH_LIMIT + ORPHAN_OVERFLOW;
const NO_ORPHANS_LEFT = 0;

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
create table calendar_accounts (
  "accountId" text,
  "email" text,
  "id" uuid primary key default gen_random_uuid(),
  "oauthCredentialId" uuid references oauth_credentials("id") on delete cascade,
  "provider" text not null,
  "userId" text not null references "user"("id") on delete cascade
);
`;

const seedOrphanedGoogleCredentials = async (count: number) => {
  await client.query(
    `insert into oauth_credentials ("accessToken", "createdAt", "email", "expiresAt", "provider", "refreshToken", "userId")
     select 'access',
            timestamptz '2026-08-24T12:00:00.000Z',
            'orphan-' || series || '@workspace.example',
            timestamptz '2026-08-26T13:00:00.000Z',
            'google',
            'refresh',
            'user-a'
     from generate_series(1, $1) as series`,
    [count],
  );
};

const remainingCredentialCount = async (): Promise<number> => {
  const result = await client.query<{ remaining: number }>(
    `select count(*)::int as remaining from oauth_credentials`,
  );

  const [row] = result.rows;

  if (!row) {
    throw new Error("Counting the remaining oauth credentials returned no row");
  }

  return row.remaining;
};

const sweepOnce = () =>
  sweepOrphanedOAuthCredentials({
    database,
    minimumAgeMs: SAFETY_AGE_MS,
    now: () => NOW,
  });

describe("orphan credential sweep claims a bounded batch", () => {
  beforeEach(async () => {
    await client.exec(`drop table if exists calendar_accounts, oauth_credentials, "user" cascade;`);
    await client.exec(DDL);
    await client.query(
      `insert into "user" ("email", "id", "name") values ('user-a@keeper.sh', 'user-a', 'User A')`,
    );
  });

  it("exports the batch limit one pass may claim", () => {
    expect(reapTeardownResidue.ORPHAN_CREDENTIAL_SWEEP_BATCH_LIMIT).toBe(
      ORPHAN_CREDENTIAL_SWEEP_BATCH_LIMIT,
    );
  });

  it("sweeps at most the batch limit in one pass and leaves the rest for the next tick", async () => {
    await seedOrphanedGoogleCredentials(SEEDED_ORPHAN_COUNT);

    expect(await sweepOnce()).toBe(ORPHAN_CREDENTIAL_SWEEP_BATCH_LIMIT);
    expect(await remainingCredentialCount()).toBe(ORPHAN_OVERFLOW);

    expect(await sweepOnce()).toBe(ORPHAN_OVERFLOW);
    expect(await remainingCredentialCount()).toBe(NO_ORPHANS_LEFT);
  });
});
