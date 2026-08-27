import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

const RESIDUE_ID = "r-a";
const RESIDUE_ACCOUNT_EMAIL = "new-name@workspace.example";
const RESIDUE_PROVIDER_ACCOUNT_ID = "google-sub-shared";
const SURVIVOR_CREDENTIAL_EMAIL = "old-name@workspace.example";

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
  accountEmail: RESIDUE_ACCOUNT_EMAIL,
  createdAt: new Date("2026-08-26T11:00:00.000Z"),
  credential: {
    accessToken: "user-a-access",
    expiresAt: new Date("2026-08-26T13:00:00.000Z"),
    refreshToken: "user-a-refresh",
  },
  expiresAt: new Date("2026-09-30T12:00:00.000Z"),
  id: RESIDUE_ID,
  kind: OAUTH_GRANT_RESIDUE_KIND,
  provider: "google",
  providerAccountId: RESIDUE_PROVIDER_ACCOUNT_ID,
  userId: "user-a",
});

const insertSurvivorHoldingTheAccountWithNoCalendarRow = async (): Promise<void> => {
  await client.query(
    `insert into "user" ("email", "id", "name") values ('user-b@keeper.sh', 'user-b', 'User B')`,
  );
  await client.query(
    `insert into oauth_credentials ("accessToken", "email", "expiresAt", "provider", "refreshToken", "userId")
     values ('user-b-access', $1, now() + interval '1 hour', 'google', 'user-b-refresh', 'user-b')`,
    [SURVIVOR_CREDENTIAL_EMAIL],
  );
};

const createHarness = () => {
  const records = [oauthGrantResidue()];
  const clearedIds: string[] = [];
  const errors: { error: unknown; slug: string }[] = [];
  const revokeOAuthGrant = vi.fn(() => Promise.resolve());

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
    revokeOAuthGrant,
  } as unknown as Parameters<typeof createTeardownResidueReaper>[0]);

  return { clearedIds, errors, reap, revokeOAuthGrant };
};

describe("a google credential linked to no calendar account is unknowable, not invisible", () => {
  beforeEach(async () => {
    await client.exec(
      `drop table if exists calendar_accounts, "account", oauth_credentials, "user" cascade;`,
    );
    await client.exec(DDL);
  });

  it("reports the identity as unresolved when a survivor holds the account through a credential with no calendar row", async () => {
    await insertSurvivorHoldingTheAccountWithNoCalendarRow();

    const census = await countSurvivingAccountLinks(database, oauthGrantResidue());

    expect(census.identityResolved).toBe(false);
  });

  it("revokes nothing and keeps the residue while that survivor's credential is unaccounted for", async () => {
    await insertSurvivorHoldingTheAccountWithNoCalendarRow();

    const harness = createHarness();
    const outcome = await harness.reap();

    expect(harness.revokeOAuthGrant).not.toHaveBeenCalled();
    expect(harness.clearedIds).toEqual([]);
    expect(outcome.clearedIds).not.toContain(RESIDUE_ID);
    expect(outcome.unresolvedIds).toContain(RESIDUE_ID);
    expect(harness.errors.map((entry) => entry.slug)).toContain(
      RESIDUE_IDENTITY_UNRESOLVED_SLUG,
    );
  });
});
