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

const RESIDUE_ID = "44444444-4444-4444-4444-444444444444";
const SURVIVOR_CREDENTIAL_ID = "55555555-5555-5555-5555-555555555555";
const SHARED_ACCOUNT_ID = "google-sub-shared";
const RENAMED_ACCOUNT_EMAIL = "new-name@workspace.example";
const STALE_ACCOUNT_EMAIL = "old-name@workspace.example";

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
  accountEmail: RENAMED_ACCOUNT_EMAIL,
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

const insertSurvivorWithStaleEmailAndUnbackfilledAccountId = async (
  accountId: string | null,
): Promise<void> => {
  const accountIdLiteral = accountId === null ? "null" : `'${accountId}'`;

  await client.query(
    `insert into "user" ("email", "id", "name") values ('b@keeper.sh', 'user-b', 'Survivor B')`,
  );
  await client.query(
    `insert into oauth_credentials ("accessToken", "email", "expiresAt", "id", "provider", "refreshToken", "userId")
     values ('b-access', '${STALE_ACCOUNT_EMAIL}', now() + interval '1 hour', '${SURVIVOR_CREDENTIAL_ID}', 'google', 'b-refresh', 'user-b')`,
  );
  await client.query(
    `insert into calendar_accounts ("accountId", "email", "oauthCredentialId", "provider", "userId")
     values (${accountIdLiteral}, '${STALE_ACCOUNT_EMAIL}', '${SURVIVOR_CREDENTIAL_ID}', 'google', 'user-b')`,
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

describe("a renamed account leaves a stale-email calendar row's identity unknowable", () => {
  beforeEach(async () => {
    await client.exec(
      `drop table if exists calendar_accounts, "account", oauth_credentials, "user" cascade;`,
    );
    await client.exec(DDL);
  });

  it("leaves the census unresolved when the survivor's only calendar row carries the stale email and a null account id", async () => {
    await insertSurvivorWithStaleEmailAndUnbackfilledAccountId(null);

    expect(
      await countSurvivingAccountLinks(database, oauthGrantResidue()),
    ).toEqual({
      blockingCredentialIds: [SURVIVOR_CREDENTIAL_ID],
      coHolders: 0,
      identityResolved: false,
    });
  });

  it("leaves the census unresolved when that stale-email row carries an empty account id", async () => {
    await insertSurvivorWithStaleEmailAndUnbackfilledAccountId("");

    expect(
      await countSurvivingAccountLinks(database, oauthGrantResidue()),
    ).toEqual({
      blockingCredentialIds: [SURVIVOR_CREDENTIAL_ID],
      coHolders: 0,
      identityResolved: false,
    });
  });

  it("posts no revocation and defers the residue instead", async () => {
    await insertSurvivorWithStaleEmailAndUnbackfilledAccountId(null);

    const harness = createHarness();
    const outcome = await harness.reap();

    expect(harness.revokedTokens).toEqual([]);
    expect(harness.clearedIds).not.toContain(RESIDUE_ID);
    expect(outcome.clearedIds).not.toContain(RESIDUE_ID);
    expect(outcome.unresolvedIds).toContain(RESIDUE_ID);
    expect(harness.errors.map((entry) => entry.slug)).toContain(
      RESIDUE_IDENTITY_UNRESOLVED_SLUG,
    );
  });

  it("resolves the census when a backfilled account id proves the survivor holds a different account", async () => {
    await insertSurvivorWithStaleEmailAndUnbackfilledAccountId(
      "google-sub-other",
    );

    expect(
      await countSurvivingAccountLinks(database, oauthGrantResidue()),
    ).toEqual({
      blockingCredentialIds: [],
      coHolders: 0,
      identityResolved: true,
    });
  });
});
