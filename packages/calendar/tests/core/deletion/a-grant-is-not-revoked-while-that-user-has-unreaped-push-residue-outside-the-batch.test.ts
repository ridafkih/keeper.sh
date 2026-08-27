import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { createTeardownResidueReaper } from "../../../src/core/deletion/teardown-residue-reaper";
import { createTeardownResidueStore } from "../../../src/core/deletion/teardown-residue-store";
import {
  OAUTH_GRANT_RESIDUE_KIND,
  PUSH_CHANNEL_RESIDUE_KIND,
} from "../../../src/core/deletion/teardown-residue";
import type { TeardownResidueRecord } from "../../../src/core/deletion/teardown-residue";
import type {
  RegistrarContext,
  SourcePushRegistrar,
} from "../../../src/core/source/push-channel";

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
const DELETED_USER_ID = "gone";
const BATCH_LIMIT = 2;
const RECORDED_AT = new Date("2026-08-26T06:15:33.956Z");
const REAP_AT = new Date(RECORDED_AT.getTime() + 20 * 60 * 1000);
const PUSH_CHANNEL_IDS = ["channel-one", "channel-two"];

const recordingStore = createTeardownResidueStore({
  batchLimit: BATCH_LIMIT,
  database,
  encryptionKey: ENCRYPTION_KEY,
  now: () => RECORDED_AT,
});

const reapingStore = createTeardownResidueStore({
  batchLimit: BATCH_LIMIT,
  database,
  encryptionKey: ENCRYPTION_KEY,
  now: () => REAP_AT,
});

const registrarContext = (): RegistrarContext => ({
  accessToken: "access",
  channelId: null,
  fetchImpl: globalThis.fetch,
  notificationUrl: "https://keeper.sh/push",
  now: REAP_AT,
  requestedExpiresAt: REAP_AT,
});

const rejectingRegistrar: SourcePushRegistrar = {
  deregister: () => Promise.reject(new Error("Google refused to stop the channel")),
  maxLifetimeMs: 7 * 24 * 60 * 60 * 1000,
  provider: "google",
  register: () => Promise.reject(new Error("registration is not part of this test")),
  renew: () => Promise.reject(new Error("renewal is not part of this test")),
  renewalMode: "recreate",
  resolveAffectedCalendarIds: () => Promise.resolve([]),
  scopeKind: "account",
  supportsList: false,
};

const residueIdOfKind = async (kind: string): Promise<string> => {
  const rows = await client.query<{ id: string }>(
    `select "id" from deletion_residue where "kind" = $1 limit 1`,
    [kind],
  );
  const [row] = rows.rows;

  if (!row) {
    throw new Error(`No ${kind} residue row was seeded`);
  }

  return row.id;
};

const createReaper = () => {
  const neverSettles = new Promise<void>(() => {});
  const revokedTokens: string[] = [];
  const errors: { error: unknown; slug: string }[] = [];

  const reap = createTeardownResidueReaper({
    countSurvivingAccountLinks: () =>
      Promise.resolve({ coHolders: 0, identityResolved: true }),
    createRegistrarContext: () => Promise.resolve(registrarContext()),
    deletePolarCustomer: () => Promise.reject(new Error("polar is not part of this test")),
    now: () => REAP_AT,
    observe: () => undefined,
    recordError: (error: unknown, slug: string) => {
      errors.push({ error, slug });
    },
    repairDeadlineMs: 30_000,
    residue: reapingStore,
    resolveRegistrar: () => rejectingRegistrar,
    revokeOAuthGrant: (_record: TeardownResidueRecord, token: string) => {
      revokedTokens.push(token);

      return Promise.resolve();
    },
    waitForRepairDeadline: () => neverSettles,
  });

  return { errors, reap, revokedTokens };
};

describe("a grant is not revoked while that user has unreaped push residue outside the batch", () => {
  beforeEach(async () => {
    await client.exec(`drop table if exists deletion_residue, "user" cascade;`);
    await client.exec(DDL);

    for (const providerChannelId of PUSH_CHANNEL_IDS) {
      await recordingStore.record({
        kind: PUSH_CHANNEL_RESIDUE_KIND,
        provider: "google",
        providerChannelId,
        providerResourceId: `resource-${providerChannelId}`,
        userId: DELETED_USER_ID,
      });
    }

    await recordingStore.record({
      accountEmail: "gone@example.com",
      credential: { accessToken: "a", expiresAt: null, refreshToken: "r" },
      kind: OAUTH_GRANT_RESIDUE_KIND,
      provider: "google",
      providerAccountId: "1099876543210",
      userId: DELETED_USER_ID,
    });

    await client.query(
      `update deletion_residue set "nextAttemptAt" = $1 where "kind" = $2`,
      [RECORDED_AT.toISOString(), OAUTH_GRANT_RESIDUE_KIND],
    );
  });

  it("defers the grant on the pass that claims it alone, because push residue for that user is still unreaped", async () => {
    const grantId = await residueIdOfKind(OAUTH_GRANT_RESIDUE_KIND);
    const harness = createReaper();

    const firstPass = await harness.reap();
    const secondPass = await harness.reap();

    expect(firstPass.scannedCount).toBe(BATCH_LIMIT);
    expect(firstPass.failedIds).toHaveLength(BATCH_LIMIT);
    expect(secondPass.scannedCount).toBe(1);
    expect(harness.revokedTokens).toEqual([]);
    expect(secondPass.deferredIds).toEqual([grantId]);
    expect(secondPass.clearedIds).toEqual([]);
  });
});
