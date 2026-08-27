import { describe, expect, it } from "vitest";
import { createTeardownResidueReaper } from "../../../src/core/deletion/teardown-residue-reaper";
import {
  OAUTH_GRANT_RESIDUE_KIND,
  PUSH_CHANNEL_RESIDUE_KIND,
} from "../../../src/core/deletion/teardown-residue";
import type {
  TeardownResidueRecord,
  TeardownResidueStore,
} from "../../../src/core/deletion/teardown-residue";
import type {
  RegistrarContext,
  SourcePushRegistrar,
  StoredPushChannel,
} from "../../../src/core/source/push-channel";

const NOW = new Date("2026-08-26T12:00:00.000Z");
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const EXPIRES_AT = new Date(NOW.getTime() + SEVEN_DAYS_MS);
const RECORDED_AT = new Date("2026-08-25T15:45:00.000Z");
const PERMANENT_FAILURE_ATTEMPT_CAP = 24;

const unresolvedGrantRecord = (): TeardownResidueRecord => ({
  accountEmail: "owner@example.com",
  attempts: PERMANENT_FAILURE_ATTEMPT_CAP,
  createdAt: RECORDED_AT,
  credential: {
    accessToken: "access-token-value",
    expiresAt: null,
    refreshToken: "refresh-token-value",
  },
  expiresAt: EXPIRES_AT,
  id: "residue-oauth",
  kind: OAUTH_GRANT_RESIDUE_KIND,
  provider: "google",
  providerAccountId: "1099876543210",
  userId: "user-oauth",
});

const transientlyFailingPushRecord = (): TeardownResidueRecord => ({
  attempts: PERMANENT_FAILURE_ATTEMPT_CAP,
  createdAt: RECORDED_AT,
  expiresAt: EXPIRES_AT,
  id: "residue-push",
  kind: PUSH_CHANNEL_RESIDUE_KIND,
  provider: "google",
  providerChannelId: "channel-1",
  providerResourceId: "resource-1",
  userId: "user-push",
});

const registrarContext = (): RegistrarContext => ({
  accessToken: "access-token-value",
  channelId: null,
  fetchImpl: globalThis.fetch,
  notificationUrl: "https://keeper.sh/webhooks/google",
  now: NOW,
  requestedExpiresAt: EXPIRES_AT,
});

const createRegistrar = (): SourcePushRegistrar =>
  ({
    deregister: (_channel: StoredPushChannel) =>
      Promise.reject(new Error("fetch failed: ECONNRESET talking to Google")),
    maxLifetimeMs: 604_800_000,
    provider: "google",
    register: () => Promise.reject(new Error("register is not part of this test")),
    renew: () => Promise.reject(new Error("renew is not part of this test")),
    renewalMode: "renew",
    resolveAffectedCalendarIds: () => Promise.resolve([]),
    scopeKind: "account",
  }) as unknown as SourcePushRegistrar;

const createHarness = (seed: TeardownResidueRecord[]) => {
  const rows = new Map(seed.map((record) => [record.id, record]));
  const clearedIds: string[] = [];
  const revokeCalls: string[] = [];
  const registrar = createRegistrar();

  const store: TeardownResidueStore = {
    clear: (residueId: string) => {
      clearedIds.push(residueId);
      rows.delete(residueId);
      return Promise.resolve();
    },
    deleteForUser: () => Promise.resolve(0),
    list: () => Promise.resolve([...rows.values()]),
    purgeOrphaned: () => Promise.resolve([]),
    record: () => Promise.resolve(),
    spendRepairAttempt: (residueId: string) => {
      const claimed = rows.get(residueId);

      if (!claimed) {
        return Promise.reject(new Error(`residue ${residueId} is not in this batch`));
      }

      return Promise.resolve(claimed.attempts ?? 0);
    },
  };

  const reap = createTeardownResidueReaper({
    countSurvivingAccountLinks: () =>
      Promise.resolve({
        blockingCredentialIds: [],
        coHolders: 0,
        identityResolved: false,
      }),
    createRegistrarContext: () => Promise.resolve(registrarContext()),
    deletePolarCustomer: () =>
      Promise.reject(new Error("polar is not part of this test")),
    now: () => NOW,
    observe: () => undefined,
    recordError: () => undefined,
    repairDeadlineMs: 5000,
    residue: store,
    resolveRegistrar: (provider: string) => (provider === "google" ? registrar : null),
    revokeOAuthGrant: (record: TeardownResidueRecord) => {
      revokeCalls.push(record.id);
      return Promise.resolve();
    },
    waitForRepairDeadline: () => new Promise<void>(() => {}),
  });

  return { clearedIds, reap, revokeCalls, rows };
};

describe("no residue is retired before its expiry", () => {
  it("keeps an unresolved grant residue at the attempt cap while its expiry is still days away", async () => {
    const harness = createHarness([unresolvedGrantRecord()]);

    const outcome = await harness.reap();

    expect(harness.clearedIds).toEqual([]);
    expect(outcome.expiredIds).toEqual([]);
    expect(outcome.unresolvedIds).toContain("residue-oauth");
    expect(harness.revokeCalls).toEqual([]);
    expect([...harness.rows.keys()]).toContain("residue-oauth");
  });

  it("keeps a transiently failing push residue at the attempt cap while its expiry is still days away", async () => {
    const harness = createHarness([transientlyFailingPushRecord()]);

    const outcome = await harness.reap();

    expect(harness.clearedIds).toEqual([]);
    expect(outcome.expiredIds).toEqual([]);
    expect(outcome.failedIds).toContain("residue-push");
    expect([...harness.rows.keys()]).toContain("residue-push");
  });

  it("retires neither record on a single pass carrying both", async () => {
    const harness = createHarness([
      unresolvedGrantRecord(),
      transientlyFailingPushRecord(),
    ]);

    const outcome = await harness.reap();

    expect(harness.clearedIds).toEqual([]);
    expect(outcome.expiredIds).toEqual([]);
    expect(outcome.unresolvedIds).toContain("residue-oauth");
    expect(outcome.failedIds).toContain("residue-push");
  });
});
