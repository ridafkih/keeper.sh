import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createTeardownResidueReaper,
  OAUTH_GRANT_RESIDUE_KIND,
} from "@keeper.sh/calendar";
import type {
  TeardownResidueRecord,
  TeardownResidueStore,
} from "@keeper.sh/calendar";
import { countSurvivingAccountLinks } from "../../src/jobs/reap-teardown-residue";

const client = new PGlite();
const database = drizzle(client);

const RESIDUE_ID = "33333333-3333-3333-3333-333333333333";
const SHARED_ACCOUNT = "foo@x.com";
const SHARED_ACCOUNT_ID = "google-sub-foo";

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
    accessToken: "a-access",
    expiresAt: new Date("2026-08-26T13:00:00.000Z"),
    refreshToken: "a-refresh",
  },
  expiresAt: new Date("2026-09-30T12:00:00.000Z"),
  id: RESIDUE_ID,
  kind: OAUTH_GRANT_RESIDUE_KIND,
  provider: "google",
  providerAccountId: SHARED_ACCOUNT_ID,
  userId: "user-a",
});

const insertSurvivorLinkedOnlyThroughSocialSignIn = async (): Promise<void> => {
  await client.query(
    `insert into "user" ("email", "id", "name") values ('b@keeper.sh', 'user-b', 'Survivor B')`,
  );
  await client.query(
    `insert into "account" ("accountId", "id", "providerId", "refreshToken", "userId")
     values ('${SHARED_ACCOUNT_ID}', 'account-b', 'google', 'live-refresh-b', 'user-b')`,
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

describe("a social sign-in account row counts as a co-holder of the grant", () => {
  beforeEach(async () => {
    await client.exec(
      `drop table if exists calendar_accounts, "account", oauth_credentials, "user" cascade;`,
    );
    await client.exec(DDL);
  });

  it("counts a surviving better-auth account row linked to the same google account", async () => {
    await insertSurvivorLinkedOnlyThroughSocialSignIn();

    const surviving = await countSurvivingAccountLinks(database, oauthGrantResidue());

    expect(surviving.coHolders).toBeGreaterThanOrEqual(1);
  });

  it("makes the reaper skip revocation when only a sign-in account row survives", async () => {
    await insertSurvivorLinkedOnlyThroughSocialSignIn();

    const harness = createHarness();
    const outcome = await harness.reap();

    expect(harness.revokedTokens).toEqual([]);
    expect(outcome.revocationSkippedIds).toContain(RESIDUE_ID);
    expect(outcome.failedIds).toEqual([]);
    expect(harness.errors).toEqual([]);
  });

  it("still counts zero when no user holds the google account any more", async () => {
    expect(await countSurvivingAccountLinks(database, oauthGrantResidue())).toEqual({
      blockingCredentialIds: [],
      coHolders: 0,
      identityResolved: true,
    });
  });
});
