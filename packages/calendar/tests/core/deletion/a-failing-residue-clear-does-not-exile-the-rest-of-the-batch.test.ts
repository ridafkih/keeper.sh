import { describe, expect, it } from "vitest";
import { createTeardownResidueReaper } from "../../../src/core/deletion/teardown-residue-reaper";
import {
  POLAR_CUSTOMER_RESIDUE_KIND,
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
const FUTURE = new Date("2026-09-30T12:00:00.000Z");
const LONG_PAST = new Date("2026-04-01T12:00:00.000Z");
const RECORDED_AT = new Date("2026-08-25T06:15:33.956Z");
const DEADLOCK_MESSAGE = "deadlock detected on deletion_residue";
const REPAIR_DEADLINE_MS = 30_000;

const expiredPushChannelForGoneUserOne = (): TeardownResidueRecord => ({
  attempts: 0,
  createdAt: RECORDED_AT,
  expiresAt: LONG_PAST,
  id: "residue-push-user-1",
  kind: PUSH_CHANNEL_RESIDUE_KIND,
  provider: "google",
  providerChannelId: "channel-user-1",
  providerResourceId: "resource-user-1",
  userId: "gone-user-1",
});

const polarCustomerForGoneUserTwo = (): TeardownResidueRecord => ({
  attempts: 0,
  createdAt: RECORDED_AT,
  expiresAt: FUTURE,
  externalId: "customer-gone-user-2",
  id: "residue-polar-user-2",
  kind: POLAR_CUSTOMER_RESIDUE_KIND,
  userId: "gone-user-2",
});

const registrarContext = (): RegistrarContext => ({
  accessToken: "access-token-value",
  channelId: null,
  fetchImpl: globalThis.fetch,
  notificationUrl: "https://keeper.sh/webhooks/google",
  now: NOW,
  requestedExpiresAt: FUTURE,
});

const createHarness = () => {
  const records = [
    expiredPushChannelForGoneUserOne(),
    polarCustomerForGoneUserTwo(),
  ];
  const revokeCalls: string[] = [];
  const clearAttempts: string[] = [];
  const deletedPolarCustomers: string[] = [];
  const observed: Record<string, unknown>[] = [];
  const errors: { error: unknown; slug: string }[] = [];
  const deregistered: StoredPushChannel[] = [];

  const residue: TeardownResidueStore = {
    clear: (residueId: string) => {
      clearAttempts.push(residueId);

      if (residueId === "residue-push-user-1") {
        return Promise.reject(new Error(DEADLOCK_MESSAGE));
      }

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

  const registrar = {
    deregister: (channel: StoredPushChannel) => {
      deregistered.push(channel);
      return Promise.resolve();
    },
    maxLifetimeMs: 604_800_000,
    provider: "google",
    register: () => Promise.reject(new Error("register is not part of this test")),
    renew: () => Promise.reject(new Error("renew is not part of this test")),
    renewalMode: "renew",
    resolveAffectedCalendarIds: () => Promise.resolve([]),
    scopeKind: "account",
  } as unknown as SourcePushRegistrar;

  const reap = createTeardownResidueReaper({
    countSurvivingAccountLinks: () =>
      Promise.resolve({
        blockingCredentialIds: [],
        coHolders: 0,
        identityResolved: false,
      }),
    createRegistrarContext: () => Promise.resolve(registrarContext()),
    deletePolarCustomer: (externalId: string) => {
      deletedPolarCustomers.push(externalId);
      return Promise.resolve();
    },
    now: () => NOW,
    observe: (fields: Record<string, unknown>) => {
      observed.push(fields);
    },
    recordError: (error: unknown, slug: string) => {
      errors.push({ error, slug });
    },
    repairDeadlineMs: REPAIR_DEADLINE_MS,
    residue,
    revokeOAuthGrant: (record: TeardownResidueRecord) => {
      revokeCalls.push(record.id);

      return Promise.resolve();
    },
    resolveRegistrar: (provider: string) => (provider === "google" ? registrar : null),
    waitForRepairDeadline: () => new Promise<void>(() => {}),
  });

  return { clearAttempts, deletedPolarCustomers, deregistered, errors, observed, reap, revokeCalls };
};

describe("a failing residue clear does not exile the rest of the batch", () => {
  it("reports the rejecting clear, keeps processing the batch, and still observes the pass", async () => {
    const harness = createHarness();

    const outcome = await harness.reap();

    expect(harness.deletedPolarCustomers).toEqual(["customer-gone-user-2"]);
    expect(outcome.clearedIds).toContain("residue-polar-user-2");
    expect(outcome.failedIds).toContain("residue-push-user-1");
    expect(outcome.expiredIds).not.toContain("residue-push-user-1");
    expect(harness.errors.map((entry) => entry.error)).toContainEqual(
      expect.objectContaining({ message: DEADLOCK_MESSAGE }),
    );
    expect(harness.observed).toHaveLength(1);
    expect(harness.observed[0]?.["teardown_residue.scanned_count"]).toBe(2);
    expect(harness.observed[0]?.["teardown_residue.failed_count"]).toBe(1);
  });
});
