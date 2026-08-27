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

const FIRST_RESIDUE_ID = "11111111-1111-1111-1111-111111111111";
const SECOND_RESIDUE_ID = "22222222-2222-2222-2222-222222222222";
const BLOCKING_CREDENTIAL_ID = "44444444-4444-4444-4444-444444444444";
const BLOCKING_CALENDAR_ACCOUNT_ID = "88888888-8888-8888-8888-888888888888";
const STRANGER_EMAIL = "stranger@example.com";

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

const oauthGrantResidue = (
  residueId: string,
  userId: string,
): TeardownResidueRecord => ({
  accountEmail: `${userId}@example.com`,
  createdAt: new Date("2026-08-26T11:00:00.000Z"),
  credential: {
    accessToken: `${userId}-access`,
    expiresAt: new Date("2026-08-26T13:00:00.000Z"),
    refreshToken: `${userId}-refresh`,
  },
  expiresAt: new Date("2026-09-30T12:00:00.000Z"),
  id: residueId,
  kind: OAUTH_GRANT_RESIDUE_KIND,
  provider: "google",
  providerAccountId: `google-sub-${userId}`,
  userId,
});

const insertStrangerWhoseCalendarRowNamesItself = async (): Promise<void> => {
  await client.query(
    `insert into "user" ("email", "id", "name") values ('${STRANGER_EMAIL}', 'stranger', 'Stranger')`,
  );
  await client.query(
    `insert into oauth_credentials ("accessToken", "email", "expiresAt", "id", "provider", "refreshToken", "userId")
     values ('stranger-access', '${STRANGER_EMAIL}', now() + interval '1 hour', '${BLOCKING_CREDENTIAL_ID}', 'google', 'stranger-refresh', 'stranger')`,
  );
  await client.query(
    `insert into calendar_accounts ("accountId", "email", "id", "oauthCredentialId", "provider", "userId")
     values (null, '${STRANGER_EMAIL}', '${BLOCKING_CALENDAR_ACCOUNT_ID}', '${BLOCKING_CREDENTIAL_ID}', 'google', 'stranger')`,
  );
  await client.query(`update calendar_accounts set "accountId" = "id"::text`);
};

const createHarness = (records: TeardownResidueRecord[]) => {
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
    observe: () => undefined,
    recordError: (error: unknown, slug: string) => {
      errors.push({ error, slug });
    },
    repairDeadlineMs: 15_000,
    residue: store,
    resolveRegistrar: () => null,
    revokeOAuthGrant: (_record: TeardownResidueRecord, token: string) => {
      revokedTokens.push(token);
      return Promise.resolve();
    },
    waitForRepairDeadline: () => new Promise<void>(() => {}),
  });

  return { clearedIds, errors, reap, revokedTokens };
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const stallReports = (errors: { error: unknown; slug: string }[]) =>
  errors.filter((entry) => entry.slug !== RESIDUE_IDENTITY_UNRESOLVED_SLUG);

describe("a fleet-wide census stall names the credentials a human has to repair", () => {
  beforeEach(async () => {
    await client.exec(
      `drop table if exists calendar_accounts, "account", oauth_credentials, "user" cascade;`,
    );
    await client.exec(DDL);
    await insertStrangerWhoseCalendarRowNamesItself();
  });

  it("reports the blocking credential under its own slug while the residue still defers", async () => {
    const harness = createHarness([oauthGrantResidue(FIRST_RESIDUE_ID, "deleted-one")]);
    const outcome = await harness.reap();

    expect(harness.revokedTokens).toEqual([]);
    expect(outcome.unresolvedIds).toContain(FIRST_RESIDUE_ID);
    expect(harness.errors.map((entry) => entry.slug)).toContain(
      RESIDUE_IDENTITY_UNRESOLVED_SLUG,
    );

    const stalls = stallReports(harness.errors);

    expect(stalls).toHaveLength(1);
    expect(messageOf(stalls[0]?.error)).toContain(BLOCKING_CREDENTIAL_ID);
  });

  it("reports the stall once per pass, not once per blocked residue", async () => {
    const harness = createHarness([
      oauthGrantResidue(FIRST_RESIDUE_ID, "deleted-one"),
      oauthGrantResidue(SECOND_RESIDUE_ID, "deleted-two"),
    ]);
    const outcome = await harness.reap();

    expect(outcome.unresolvedIds).toEqual([FIRST_RESIDUE_ID, SECOND_RESIDUE_ID]);
    expect(
      harness.errors.filter((entry) => entry.slug === RESIDUE_IDENTITY_UNRESOLVED_SLUG),
    ).toHaveLength(2);
    expect(stallReports(harness.errors)).toHaveLength(1);
  });
});
