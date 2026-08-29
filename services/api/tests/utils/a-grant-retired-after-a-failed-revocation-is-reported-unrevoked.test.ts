import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createTeardownResidueReaper,
  createTeardownResidueStore,
  OAUTH_GRANT_RESIDUE_KIND,
  RESIDUE_GRANT_RETIRED_UNREVOKED_SLUG,
} from "@keeper.sh/calendar";
import type { TeardownResidueRecord } from "@keeper.sh/calendar";

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
const RECORDED_AT = new Date("2026-08-25T06:00:00.000Z");
const PASS_INTERVAL_MS = 2 * 60 * 60 * 1000;
const PASSES_TO_RETIREMENT = 6;
const DELETED_USER_ID = "deleted-customer";
const REPAIR_DEADLINE_MS = 10_000;

const createHarness = () => {
  const clock = { at: RECORDED_AT };
  const errors: { error: unknown; slug: string }[] = [];
  const revocationAttempts: string[] = [];

  const residue = createTeardownResidueStore({
    database,
    encryptionKey: ENCRYPTION_KEY,
    now: () => clock.at,
  });

  const reap = createTeardownResidueReaper({
    countSurvivingAccountLinks: () =>
      Promise.resolve({
        blockingCredentialIds: [],
        coHolders: 0,
        identityResolved: true,
      }),
    createRegistrarContext: () =>
      Promise.reject(new Error("push channels are not part of this test")),
    deletePolarCustomer: () =>
      Promise.reject(new Error("polar is not part of this test")),
    now: () => clock.at,
    observe: () => undefined,
    recordError: (error: unknown, slug: string) => {
      errors.push({ error, slug });
    },
    repairDeadlineMs: REPAIR_DEADLINE_MS,
    residue,
    resolveRegistrar: () => null,
    revokeOAuthGrant: (record: TeardownResidueRecord, token: string) => {
      revocationAttempts.push(token);

      return Promise.reject(
        new Error(
          `Google refused to revoke the grant behind residue ${record.id}: the provider is unreachable`,
        ),
      );
    },
    waitForRepairDeadline: () =>
      Promise.reject(new Error("the repair deadline is not part of this test")),
  });

  const advance = () => {
    clock.at = new Date(clock.at.getTime() + PASS_INTERVAL_MS);
  };

  return { advance, errors, reap, residue, revocationAttempts };
};

const residueIds = async (): Promise<string[]> => {
  const rows = await client.query<{ id: string }>(
    `select "id" from deletion_residue`,
  );

  return rows.rows.map((row) => row.id);
};

beforeEach(async () => {
  await client.exec(`drop table if exists deletion_residue; drop table if exists "user";`);
  await client.exec(DDL);
});

describe("a grant retired after a failed revocation is reported unrevoked", () => {
  it("emits the retired-unrevoked slug and counts the id when revocation kept throwing", async () => {
    const harness = createHarness();

    await harness.residue.record({
      accountEmail: "deleted-customer@gmail.com",
      credential: {
        accessToken: "stranded-access",
        expiresAt: null,
        refreshToken: "stranded-refresh",
      },
      kind: OAUTH_GRANT_RESIDUE_KIND,
      provider: "google",
      providerAccountId: "1099876543210",
      userId: DELETED_USER_ID,
    });

    const [recordedId] = await residueIds();

    expect(recordedId).toBeDefined();

    const outcomes = [];

    for (let pass = 0; pass < PASSES_TO_RETIREMENT; pass += 1) {
      harness.advance();
      outcomes.push(await harness.reap());
    }

    const finalOutcome = outcomes.at(-1);

    expect(harness.revocationAttempts).toHaveLength(PASSES_TO_RETIREMENT);
    expect(finalOutcome?.expiredIds).toEqual([recordedId]);
    expect(await residueIds()).toEqual([]);

    expect(
      harness.errors
        .filter((entry) => entry.slug === RESIDUE_GRANT_RETIRED_UNREVOKED_SLUG)
        .length,
    ).toBe(1);
    expect(finalOutcome?.retiredUnrevokedIds).toEqual([recordedId]);
  });
});
