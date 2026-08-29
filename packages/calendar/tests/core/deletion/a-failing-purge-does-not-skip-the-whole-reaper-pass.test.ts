import { describe, expect, it } from "vitest";
import { createTeardownResidueReaper } from "../../../src/core/deletion/teardown-residue-reaper";
import { PUSH_CHANNEL_RESIDUE_KIND } from "../../../src/core/deletion/teardown-residue";
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
const RECORDED_AT = new Date("2026-08-25T06:15:33.956Z");
const PURGE_FAILURE_MESSAGE = "connection terminated while purging deletion_residue";
const REPAIR_DEADLINE_MS = 30_000;

const pushChannelForGoneUser = (): TeardownResidueRecord => ({
  attempts: 0,
  createdAt: RECORDED_AT,
  credential: {
    accessToken: "access-token-value",
    expiresAt: null,
    refreshToken: "refresh-token-value",
  },
  expiresAt: FUTURE,
  id: "residue-channel-gone-user",
  kind: PUSH_CHANNEL_RESIDUE_KIND,
  provider: "google",
  providerChannelId: "channel-gone-user",
  providerResourceId: "resource-gone-user",
  userId: "gone-user",
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
  const records = [pushChannelForGoneUser()];
  const clearedIds: string[] = [];
  const listCalls: number[] = [];
  const deregistrations: (string | null)[] = [];
  const observed: Record<string, unknown>[] = [];
  const errors: { error: unknown; slug: string }[] = [];

  const residue: TeardownResidueStore = {
    clear: (residueId: string) => {
      clearedIds.push(residueId);
      return Promise.resolve();
    },
    deleteForUser: () => Promise.resolve(0),
    list: () => {
      listCalls.push(listCalls.length);
      return Promise.resolve(records);
    },
    purgeOrphaned: () => Promise.reject(new Error(PURGE_FAILURE_MESSAGE)),
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
      deregistrations.push(channel.providerChannelId);
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
    deletePolarCustomer: () =>
      Promise.reject(new Error("polar is not part of this test")),
    now: () => NOW,
    observe: (fields: Record<string, unknown>) => {
      observed.push(fields);
    },
    recordError: (error: unknown, slug: string) => {
      errors.push({ error, slug });
    },
    repairDeadlineMs: REPAIR_DEADLINE_MS,
    residue,
    resolveRegistrar: (provider: string) => (provider === "google" ? registrar : null),
    waitForRepairDeadline: () => new Promise<void>(() => {}),
  });

  return { clearedIds, deregistrations, errors, listCalls, observed, reap };
};

describe("a failing purge does not skip the whole reaper pass", () => {
  it("reports the rejecting purge, still lists and repairs, and observes a zero purged count", async () => {
    const harness = createHarness();

    const outcome = await harness.reap();

    expect(harness.listCalls).toHaveLength(1);
    expect(harness.deregistrations).toEqual(["channel-gone-user"]);
    expect(harness.clearedIds).toEqual(["residue-channel-gone-user"]);
    expect(outcome.clearedIds).toEqual(["residue-channel-gone-user"]);
    expect(outcome.purgedIds).toEqual([]);
    expect(harness.errors.map((entry) => entry.error)).toContainEqual(
      expect.objectContaining({ message: PURGE_FAILURE_MESSAGE }),
    );
    expect(harness.observed).toHaveLength(1);
    expect(harness.observed[0]?.["teardown_residue.purged_count"]).toBe(0);
    expect(harness.observed[0]?.["teardown_residue.scanned_count"]).toBe(1);
    expect(harness.observed[0]?.["teardown_residue.cleared_count"]).toBe(1);
  });
});
