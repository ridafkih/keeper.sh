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

const RESIDUE_ID = "55555555-5555-5555-5555-555555555555";
const SHARED_ACCOUNT = "shared@gmail.com";
const SHARED_ACCOUNT_ID = "google-sub-shared";
const DELETED_USER_TOKEN = "deleted-user-refresh-token";
const SURVIVING_USER_TOKEN = "surviving-user-refresh-token";

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
    accessToken: "deleted-user-access-token",
    expiresAt: new Date("2026-08-26T13:00:00.000Z"),
    refreshToken: DELETED_USER_TOKEN,
  },
  expiresAt: new Date("2026-09-30T12:00:00.000Z"),
  id: RESIDUE_ID,
  kind: OAUTH_GRANT_RESIDUE_KIND,
  provider: "google",
  providerAccountId: SHARED_ACCOUNT_ID,
  userId: "deleted-user",
});

const insertSurvivorHoldingTheSameGoogleAccount = async (): Promise<void> => {
  await client.query(
    `insert into "user" ("email", "id", "name") values ('survivor@keeper.sh', 'surviving-user', 'Survivor')`,
  );
  await client.query(
    `insert into oauth_credentials ("accessToken", "email", "expiresAt", "provider", "refreshToken", "userId")
     values ('surviving-user-access-token', '${SHARED_ACCOUNT}', now() + interval '1 hour', 'google', '${SURVIVING_USER_TOKEN}', 'surviving-user')`,
  );
};

const createHarness = () => {
  const records = [oauthGrantResidue()];
  const clearedIds: string[] = [];
  const errors: { error: unknown; slug: string }[] = [];
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
    observe: () => {},
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

  return { clearedIds, errors, reap, revokedTokens };
};

describe("the reaper refuses to revoke a google account a surviving user still holds", () => {
  beforeEach(async () => {
    await client.exec(
      `drop table if exists calendar_accounts, "account", oauth_credentials, "user" cascade;`,
    );
    await client.exec(DDL);
  });

  it("counts the surviving credential row as a co-holder of the grant", async () => {
    await insertSurvivorHoldingTheSameGoogleAccount();

    expect(await countSurvivingAccountLinks(database, oauthGrantResidue())).toEqual({
      blockingCredentialIds: [],
      coHolders: 1,
      identityResolved: true,
    });
  });

  it("revokes nothing and settles the residue while the survivor holds the account", async () => {
    await insertSurvivorHoldingTheSameGoogleAccount();

    const harness = createHarness();
    const outcome = await harness.reap();

    expect(harness.revokedTokens).toEqual([]);
    expect(harness.clearedIds).toContain(RESIDUE_ID);
    expect(outcome.revocationSkippedIds).toContain(RESIDUE_ID);
    expect(outcome.failedIds).toEqual([]);
    expect(harness.errors).toEqual([]);
  });

  it("revokes only the deleted user's own token once no survivor holds the account", async () => {
    const harness = createHarness();
    const outcome = await harness.reap();

    expect(harness.revokedTokens).toEqual([DELETED_USER_TOKEN]);
    expect(harness.revokedTokens).not.toContain(SURVIVING_USER_TOKEN);
    expect(outcome.failedIds).toEqual([]);
  });
});
