import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createTeardownResidueReaper,
  OAUTH_GRANT_RESIDUE_KIND,
  RESIDUE_IDENTITY_UNRESOLVED_SLUG,
} from "@keeper.sh/calendar";
import type {
  TeardownResidueRecord,
  TeardownResidueStore,
} from "@keeper.sh/calendar";
import { countSurvivingAccountLinks } from "../../src/jobs/reap-teardown-residue";

const client = new PGlite();
const database = drizzle(client);

const RESIDUE_ID = "33333333-3333-3333-3333-333333333333";
const DELETED_ACCOUNT_EMAIL = "deleted-person@example.com";
const DELETED_PROVIDER_ACCOUNT_ID = "google-sub-deleted";

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
  accountEmail: DELETED_ACCOUNT_EMAIL,
  createdAt: new Date("2026-08-26T11:00:00.000Z"),
  credential: {
    accessToken: "deleted-person-access",
    expiresAt: new Date("2026-08-26T13:00:00.000Z"),
    refreshToken: "deleted-person-refresh",
  },
  expiresAt: new Date("2026-09-30T12:00:00.000Z"),
  id: RESIDUE_ID,
  kind: OAUTH_GRANT_RESIDUE_KIND,
  provider: "google",
  providerAccountId: DELETED_PROVIDER_ACCOUNT_ID,
  userId: "deleted-person",
});

const insertStrangerWithLegacyNullEmailCredential = async (): Promise<void> => {
  await client.query(
    `insert into "user" ("email", "id", "name") values ('stranger@keeper.sh', 'stranger', 'Stranger')`,
  );
  await client.query(
    `insert into oauth_credentials ("accessToken", "email", "expiresAt", "provider", "refreshToken", "userId")
     values ('stranger-access', null, now() + interval '1 hour', 'google', 'stranger-refresh', 'stranger')`,
  );
  await client.query(
    `insert into calendar_accounts ("accountId", "oauthCredentialId", "provider", "userId")
     select null, "id", 'google', 'stranger' from oauth_credentials where "userId" = 'stranger'`,
  );
};

const deleteStrangerLegacyCredential = async (): Promise<void> => {
  await client.query(
    `delete from oauth_credentials where "userId" = 'stranger'`,
  );
};

const createHarness = () => {
  const records = [oauthGrantResidue()];
  const clearedIds: string[] = [];
  const errors: { error: unknown; slug: string }[] = [];
  const observed: Record<string, unknown>[] = [];
  const revokedTokens: string[] = [];

  const store: TeardownResidueStore = {
    clear: (residueId: string) => {
      clearedIds.push(residueId);
      return Promise.resolve();
    },
    deleteForUser: () => Promise.resolve(0),
    list: () => Promise.resolve(records),
    purgeOrphaned: () => Promise.resolve([]),
    record: () => Promise.resolve(),
    spendRepairAttempt: (residueId: string) => {
      const claimed = records.find((candidate) => candidate.id === residueId);

      if (!claimed) {
        return Promise.reject(new Error(`residue ${residueId} is not in this batch`));
      }

      return Promise.resolve(claimed.attempts ?? 0);
    },
  };

  const reap = createTeardownResidueReaper({
    countSurvivingAccountLinks: (record: TeardownResidueRecord) =>
      countSurvivingAccountLinks(database, record),
    createRegistrarContext: () =>
      Promise.reject(new Error("push channels are not part of this test")),
    deletePolarCustomer: () =>
      Promise.reject(new Error("polar is not part of this test")),
    now: () => new Date("2026-08-26T12:00:00.000Z"),
    observe: (fields: Record<string, unknown>) => {
      observed.push(fields);
    },
    recordError: (error: unknown, slug: string) => {
      errors.push({ error, slug });
    },
    residue: store,
    resolveRegistrar: () => null,
    revokeOAuthGrant: (_record: TeardownResidueRecord, token: string) => {
      revokedTokens.push(token);
      return Promise.resolve();
    },
  } as unknown as Parameters<typeof createTeardownResidueReaper>[0]);

  return { clearedIds, errors, observed, reap, revokedTokens };
};

describe("a credential row of unknown identity defers a revocation instead of blocking it forever", () => {
  beforeEach(async () => {
    await client.exec(
      `drop table if exists calendar_accounts, "account", oauth_credentials, "user" cascade;`,
    );
    await client.exec(DDL);
  });

  it("keeps the residue and revokes nothing while one stranger's null-email row makes the answer indeterminate", async () => {
    await insertStrangerWithLegacyNullEmailCredential();

    const harness = createHarness();
    const outcome = await harness.reap();

    expect(harness.revokedTokens).toEqual([]);
    expect(harness.clearedIds).not.toContain(RESIDUE_ID);
    expect(outcome.clearedIds).not.toContain(RESIDUE_ID);
    expect(outcome.revocationSkippedIds).not.toContain(RESIDUE_ID);
    expect(outcome.unresolvedIds).toContain(RESIDUE_ID);
    expect(harness.errors.map((entry) => entry.slug)).toContain(
      RESIDUE_IDENTITY_UNRESOLVED_SLUG,
    );
  });

  it("keeps deferring on the next pass rather than destroying the token", async () => {
    await insertStrangerWithLegacyNullEmailCredential();

    const harness = createHarness();
    await harness.reap();
    const outcome = await harness.reap();

    expect(harness.revokedTokens).toEqual([]);
    expect(harness.clearedIds).toEqual([]);
    expect(outcome.unresolvedIds).toContain(RESIDUE_ID);
  });

  it("revokes the deleted customer's grant once the legacy row is gone", async () => {
    await insertStrangerWithLegacyNullEmailCredential();

    const blocked = createHarness();
    await blocked.reap();

    expect(blocked.revokedTokens).toEqual([]);

    await deleteStrangerLegacyCredential();

    const harness = createHarness();
    const outcome = await harness.reap();

    expect(harness.revokedTokens).toEqual(["deleted-person-refresh"]);
    expect(outcome.clearedIds).toContain(RESIDUE_ID);
    expect(outcome.unresolvedIds).toEqual([]);
    expect(harness.errors).toEqual([]);
  });
});
