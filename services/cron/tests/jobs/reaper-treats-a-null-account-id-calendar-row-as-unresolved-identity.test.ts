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

const RESIDUE_ID = "88888888-8888-8888-8888-888888888888";
const RESIDUE_ACCOUNT_ID = "222222222222222222222";
const SURVIVOR_CREDENTIAL_ID = "99999999-9999-9999-9999-999999999999";

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
  accountEmail: "deleted-user@gmail.com",
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

const insertSurvivor = async (email: string | null): Promise<void> => {
  const emailLiteral = email === null ? "null" : `'${email}'`;

  await client.query(
    `insert into "user" ("email", "id", "name") values ('b@keeper.sh', 'user-b', 'Survivor B')`,
  );
  await client.query(
    `insert into oauth_credentials ("accessToken", "email", "expiresAt", "id", "provider", "refreshToken", "userId")
     values ('b-access', ${emailLiteral}, now() + interval '1 hour', '${SURVIVOR_CREDENTIAL_ID}', 'google', 'b-refresh', 'user-b')`,
  );
};

const linkSurvivorCalendarAccount = async (
  accountId: string | null,
): Promise<void> => {
  const accountIdLiteral = accountId === null ? "null" : `'${accountId}'`;

  await client.query(
    `insert into calendar_accounts ("accountId", "oauthCredentialId", "provider", "userId")
     values (${accountIdLiteral}, '${SURVIVOR_CREDENTIAL_ID}', 'google', 'user-b')`,
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

describe("a calendar account row with a null account id proves nothing about a credential's identity", () => {
  beforeEach(async () => {
    await client.exec(
      `drop table if exists calendar_accounts, "account", oauth_credentials, "user" cascade;`,
    );
    await client.exec(DDL);
  });

  it("leaves the census unresolved for a null-email credential whose calendar account row carries a null account id", async () => {
    await insertSurvivor(null);
    await linkSurvivorCalendarAccount(null);

    expect(await countSurvivingAccountLinks(database, oauthGrantResidue())).toEqual({
      blockingCredentialIds: [SURVIVOR_CREDENTIAL_ID],
      coHolders: 0,
      identityResolved: false,
    });
  });

  it("leaves the census unresolved when that row carries an empty account id", async () => {
    await insertSurvivor(null);
    await linkSurvivorCalendarAccount("");

    expect(await countSurvivingAccountLinks(database, oauthGrantResidue())).toEqual({
      blockingCredentialIds: [SURVIVOR_CREDENTIAL_ID],
      coHolders: 0,
      identityResolved: false,
    });
  });

  it("revokes nothing and defers the residue while a null-account-id row is the only evidence", async () => {
    await insertSurvivor(null);
    await linkSurvivorCalendarAccount(null);

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

  it("still counts a credential whose email matches the residue account as a co-holder", async () => {
    await insertSurvivor("deleted-user@gmail.com");
    await linkSurvivorCalendarAccount(null);

    const census = await countSurvivingAccountLinks(database, oauthGrantResidue());

    expect(census.coHolders).toBeGreaterThanOrEqual(1);
  });

  it("leaves the census unresolved for a null-email credential with no calendar account row at all", async () => {
    await insertSurvivor(null);

    expect(await countSurvivingAccountLinks(database, oauthGrantResidue())).toEqual({
      blockingCredentialIds: [SURVIVOR_CREDENTIAL_ID],
      coHolders: 0,
      identityResolved: false,
    });
  });
});
