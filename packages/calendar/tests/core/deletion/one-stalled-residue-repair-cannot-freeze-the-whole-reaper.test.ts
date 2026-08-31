import { describe, expect, it } from "vitest";
import {
  createTeardownResidueReaper,
  RESIDUE_REPAIR_FAILED_SLUG,
} from "../../../src/core/deletion/teardown-residue-reaper";
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
const REPAIR_DEADLINE_MS = 5000;
const RUN_PATIENCE_MS = 2000;

const stalledPolarRecord = (): TeardownResidueRecord => ({
  createdAt: new Date("2026-08-25T06:15:33.956Z"),
  expiresAt: FUTURE,
  externalId: "polar-external-1",
  id: "residue-polar-1",
  kind: POLAR_CUSTOMER_RESIDUE_KIND,
  userId: "user-1",
});

const pushChannelRecord = (): TeardownResidueRecord => ({
  createdAt: new Date("2026-08-25T06:15:33.956Z"),
  credential: {
    accessToken: "user-2-access-token",
    expiresAt: null,
    refreshToken: "user-2-refresh-token",
  },
  expiresAt: FUTURE,
  id: "residue-channel-2",
  kind: PUSH_CHANNEL_RESIDUE_KIND,
  provider: "google",
  providerChannelId: "channel-2",
  providerResourceId: "resource-2",
  userId: "user-2",
});

const registrarContext = (): RegistrarContext => ({
  accessToken: "user-2-access-token",
  channelId: null,
  fetchImpl: globalThis.fetch,
  notificationUrl: "https://keeper.sh/webhooks/google",
  now: NOW,
  requestedExpiresAt: FUTURE,
});

const stalledRepair = (): Promise<never> => Promise.withResolvers<never>().promise;

const createHarness = () => {
  const clearedIds: string[] = [];
  const deregistrations: { channelId: string | null; userId: string }[] = [];
  const errors: { error: unknown; slug: string }[] = [];
  const deadlinesRequested: number[] = [];

  const store: TeardownResidueStore = {
    clear: (residueId: string) => {
      clearedIds.push(residueId);
      return Promise.resolve();
    },
    deleteForUser: () => Promise.resolve(0),
    list: () => Promise.resolve([stalledPolarRecord(), pushChannelRecord()]),
    purgeOrphaned: () => Promise.resolve([]),
    record: () => Promise.resolve(),
    spendRepairAttempt: () => Promise.resolve(0),
  };

  const registrar = {
    deregister: (channel: StoredPushChannel) => {
      deregistrations.push({ channelId: channel.providerChannelId, userId: channel.userId });
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
    createRegistrarContext: () => Promise.resolve(registrarContext()),
    deletePolarCustomer: () => stalledRepair(),
    now: () => NOW,
    observe: () => undefined,
    recordError: (error: unknown, slug: string) => {
      errors.push({ error, slug });
    },
    repairDeadlineMs: REPAIR_DEADLINE_MS,
    residue: store,
    resolveRegistrar: (provider: string) => (provider === "google" ? registrar : null),
    waitForRepairDeadline: (deadlineMs: number) => {
      deadlinesRequested.push(deadlineMs);
      return Promise.resolve();
    },
  } as unknown as Parameters<typeof createTeardownResidueReaper>[0]);

  return { clearedIds, deadlinesRequested, deregistrations, errors, reap };
};

describe("one stalled residue repair cannot freeze the whole reaper", () => {
  it("abandons the hung polar repair on its deadline and still stops the next user's channel", async () => {
    const harness = createHarness();

    const outcome = await Promise.race([
      harness.reap(),
      new Promise<"stalled">((resolve) => {
        setTimeout(() => resolve("stalled"), RUN_PATIENCE_MS);
      }),
    ]);

    expect(outcome).not.toBe("stalled");

    if (outcome === "stalled") {
      return;
    }

    expect(harness.deregistrations).toEqual([
      { channelId: "channel-2", userId: "user-2" },
    ]);
    expect(outcome.clearedIds).toEqual(["residue-channel-2"]);
    expect(harness.clearedIds).toEqual(["residue-channel-2"]);
    expect(outcome.failedIds).toEqual(["residue-polar-1"]);
    expect(outcome.clearedIds).not.toContain("residue-polar-1");
    expect(harness.deadlinesRequested).toEqual([REPAIR_DEADLINE_MS]);
    expect(harness.errors.map((entry) => entry.slug)).toEqual([
      RESIDUE_REPAIR_FAILED_SLUG,
    ]);
  });
});
