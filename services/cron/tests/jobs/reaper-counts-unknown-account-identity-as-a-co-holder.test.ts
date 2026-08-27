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

const RESIDUE_ID = "22222222-2222-2222-2222-222222222222";
const SHARED_ACCOUNT = "shared@gmail.com";
const RESIDUE_ACCOUNT_ID = "google-sub-shared";

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
  accountEmail: SHARED_ACCOUNT,
  createdAt: new Date("2026-08-26T11:00:00.000Z"),
  credential: {
    accessToken: "deleted-user-access",
    expiresAt: new Date("2026-08-26T13:00:00.000Z"),
    refreshToken: "deleted-user-refresh",
  },
  expiresAt: new Date("2026-09-30T12:00:00.000Z"),
  id: RESIDUE_ID,
  kind: OAUTH_GRANT_RESIDUE_KIND,
  provider: "google",
  providerAccountId: RESIDUE_ACCOUNT_ID,
  userId: "deleted-user",
});

const insertSurvivorWithUnknownAccountIdentity = async (): Promise<void> => {
  await client.query(
    `insert into "user" ("email", "id", "name") values ('survivor@keeper.sh', 'B', 'Survivor B')`,
  );
  await client.query(
    `insert into oauth_credentials ("accessToken", "email", "expiresAt", "provider", "refreshToken", "userId")
     values ('survivor-access', null, now() + interval '1 hour', 'google', 'survivor-refresh', 'B')`,
  );
  await client.query(
    `insert into calendar_accounts ("accountId", "oauthCredentialId", "provider", "userId")
     select null, "id", 'google', 'B' from oauth_credentials where "userId" = 'B'`,
  );
};

const insertSurvivorSharingTheAccount = async (): Promise<void> => {
  await client.query(
    `insert into "user" ("email", "id", "name") values ('coholder@keeper.sh', 'C', 'Co-holder C')`,
  );
  await client.query(
    `insert into oauth_credentials ("accessToken", "email", "expiresAt", "provider", "refreshToken", "userId")
     values ('coholder-access', '${SHARED_ACCOUNT}', now() + interval '1 hour', 'google', 'coholder-refresh', 'C')`,
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

describe("an account identity the reaper cannot resolve never becomes a revocation", () => {
  beforeEach(async () => {
    await client.exec(
      `drop table if exists calendar_accounts, "account", oauth_credentials, "user" cascade;`,
    );
    await client.exec(DDL);
  });

  it("never revokes while a surviving row's account identity is unknown", async () => {
    await insertSurvivorWithUnknownAccountIdentity();

    const harness = createHarness();
    await harness.reap();

    expect(harness.revokedTokens).toEqual([]);
  });

  it("keeps the residue for a later pass instead of clearing it", async () => {
    await insertSurvivorWithUnknownAccountIdentity();

    const harness = createHarness();
    const outcome = await harness.reap();

    expect(harness.clearedIds).toEqual([]);
    expect(outcome.unresolvedIds).toContain(RESIDUE_ID);
    expect(harness.errors.map((entry) => entry.slug)).toContain(
      RESIDUE_IDENTITY_UNRESOLVED_SLUG,
    );
  });

  it("never revokes while a survivor demonstrably shares the account", async () => {
    await insertSurvivorSharingTheAccount();

    const harness = createHarness();
    const outcome = await harness.reap();

    expect(harness.revokedTokens).toEqual([]);
    expect(outcome.revocationSkippedIds).toContain(RESIDUE_ID);
    expect(outcome.failedIds).toEqual([]);
    expect(harness.errors).toEqual([]);
  });

  it("revokes when no google row survives at all", async () => {
    const harness = createHarness();
    const outcome = await harness.reap();

    expect(harness.revokedTokens).toEqual(["deleted-user-refresh"]);
    expect(outcome.clearedIds).toContain(RESIDUE_ID);
    expect(outcome.unresolvedIds).toEqual([]);
  });
});
