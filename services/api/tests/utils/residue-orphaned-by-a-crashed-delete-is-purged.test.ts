import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createTeardownResidueReaper,
  createTeardownResidueStore,
  OAUTH_GRANT_RESIDUE_KIND,
  RESIDUE_LIFETIME_MS,
} from "@keeper.sh/calendar";

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
const CRASHED_AT = new Date("2026-08-25T06:15:33.956Z");
const A_YEAR_PAST_EXPIRY = new Date(
  CRASHED_AT.getTime() + RESIDUE_LIFETIME_MS + 365 * 24 * 60 * 60 * 1000,
);
const RESIDUE_REPAIR_DEADLINE_MS = 15_000;
const STILL_WITHIN_LIFETIME = new Date(CRASHED_AT.getTime() + 60 * 1000);

const createHarness = (reapAt: Date) => {
  const recorder = createTeardownResidueStore({
    database,
    encryptionKey: ENCRYPTION_KEY,
    now: () => CRASHED_AT,
  });
  const residue = createTeardownResidueStore({
    database,
    encryptionKey: ENCRYPTION_KEY,
    now: () => reapAt,
  });
  const observed: Record<string, unknown>[] = [];
  const errors: { error: unknown; slug: string }[] = [];

  const reap = createTeardownResidueReaper({
    countSurvivingAccountLinks: () =>
      Promise.reject(new Error("a purge must never probe provider account links")),
    createRegistrarContext: () =>
      Promise.reject(new Error("a purge must never build a registrar context")),
    deletePolarCustomer: () =>
      Promise.reject(new Error("a purge must never call polar")),
    now: () => reapAt,
    observe: (fields: Record<string, unknown>) => {
      observed.push(fields);
    },
    recordError: (error: unknown, slug: string) => {
      errors.push({ error, slug });
    },
    repairDeadlineMs: RESIDUE_REPAIR_DEADLINE_MS,
    residue,
    resolveRegistrar: () => {
      throw new Error("a purge must never resolve a push registrar");
    },
    revokeOAuthGrant: () =>
      Promise.reject(new Error("a purge must never revoke a live customer's grant")),
    waitForRepairDeadline: () =>
      Promise.reject(new Error("a purge must never wait on a repair deadline")),
  });

  return { errors, observed, reap, recorder };
};

const recordOrphanedGrantResidue = async (
  recorder: ReturnType<typeof createTeardownResidueStore>,
): Promise<void> => {
  await recorder.record({
    accountEmail: "paying-customer@example.com",
    credential: {
      accessToken: "live-access-token",
      expiresAt: new Date("2026-08-25T07:00:00.000Z"),
      refreshToken: "live-refresh-token",
    },
    kind: OAUTH_GRANT_RESIDUE_KIND,
    provider: "google",
    providerAccountId: "1099876543210",
    userId: "survivor",
  });
};

const residueIds = async (): Promise<string[]> => {
  const rows = await client.query<{ id: string }>(
    `select "id" from deletion_residue order by "createdAt"`,
  );

  return rows.rows.map((row) => row.id);
};

describe("residue orphaned by a crashed delete", () => {
  beforeEach(async () => {
    await client.exec(`drop table if exists deletion_residue, "user" cascade;`);
    await client.exec(DDL);
    await client.query(
      `insert into "user" ("email", "id", "name")
       values ('paying-customer@example.com', 'survivor', 'Paying Customer')`,
    );
  });

  it("purges an expired residue row whose user row still exists", async () => {
    const { reap, recorder } = createHarness(A_YEAR_PAST_EXPIRY);
    await recordOrphanedGrantResidue(recorder);
    const [orphanId] = await residueIds();

    const outcome = await reap();

    expect(outcome.purgedIds).toEqual([orphanId]);
    expect(await residueIds()).toEqual([]);
  });

  it("purges without dialing a provider or claiming the row for repair", async () => {
    const { errors, observed, reap, recorder } = createHarness(A_YEAR_PAST_EXPIRY);
    await recordOrphanedGrantResidue(recorder);

    const outcome = await reap();

    expect(outcome.scannedCount).toBe(0);
    expect(outcome.expiredIds).toEqual([]);
    expect(outcome.clearedIds).toEqual([]);
    expect(errors).toEqual([]);
    expect(observed.at(0)).toMatchObject({ "teardown_residue.purged_count": 1 });
  });

  it("leaves a not-yet-expired residue for a live user untouched", async () => {
    const { reap, recorder } = createHarness(STILL_WITHIN_LIFETIME);
    await recordOrphanedGrantResidue(recorder);
    const [inFlightId] = await residueIds();

    const outcome = await reap();

    expect(outcome.purgedIds).toEqual([]);
    expect(await residueIds()).toEqual([inFlightId]);
  });
});
