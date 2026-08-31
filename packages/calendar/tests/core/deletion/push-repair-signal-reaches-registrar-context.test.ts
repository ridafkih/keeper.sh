import { describe, expect, it } from "vitest";
import { createTeardownResidueReaper } from "../../../src/core/deletion/teardown-residue-reaper";
import { PUSH_CHANNEL_RESIDUE_KIND } from "../../../src/core/deletion/teardown-residue";
import type {
  TeardownResidueRecord,
  TeardownResidueStore,
} from "../../../src/core/deletion/teardown-residue";

const NOW = new Date("2026-08-26T12:00:00.000Z");
const FUTURE = new Date("2026-09-30T12:00:00.000Z");
const RECORDED_AT = new Date("2026-08-25T06:15:33.956Z");
const REPAIR_DEADLINE_MS = 50;
const SETTLE_MS = 200;
const FIRST_ATTEMPT = 1;

const pushChannelRecord = (): TeardownResidueRecord => ({
  createdAt: RECORDED_AT,
  expiresAt: FUTURE,
  id: "residue-push-1",
  kind: PUSH_CHANNEL_RESIDUE_KIND,
  provider: "google",
  providerChannelId: "channel-1",
  providerResourceId: "resource-1",
  userId: "user-1",
});

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const createHarness = () => {
  const contextArguments: unknown[] = [];
  const abortedWhenCalled: boolean[] = [];
  const deregisterCalls: string[] = [];

  const store: TeardownResidueStore = {
    clear: () => Promise.resolve(),
    deleteForUser: () => Promise.resolve(0),
    list: () => Promise.resolve([pushChannelRecord()]),
    purgeOrphaned: () => Promise.resolve([]),
    record: () => Promise.resolve(),
    spendRepairAttempt: () => Promise.resolve(FIRST_ATTEMPT),
  };

  const reap = createTeardownResidueReaper({
    countSurvivingAccountLinks: () =>
      Promise.resolve({
        blockingCredentialIds: [],
        coHolders: 0,
        identityResolved: true,
      }),
    createRegistrarContext: (_record: TeardownResidueRecord, signal: unknown) => {
      contextArguments.push(signal);
      abortedWhenCalled.push(signal instanceof AbortSignal ? signal.aborted : false);

      return new Promise((resolve) => {
        if (signal instanceof AbortSignal) {
          signal.addEventListener("abort", () => resolve({}));
        }
      });
    },
    deletePolarCustomer: () =>
      Promise.reject(new Error("polar customers are not part of this test")),
    now: () => NOW,
    observe: () => undefined,
    recordError: () => undefined,
    repairDeadlineMs: REPAIR_DEADLINE_MS,
    residue: store,
    resolveRegistrar: () => ({
      deregister: (channel: { providerChannelId: string }) => {
        deregisterCalls.push(channel.providerChannelId);
        return Promise.resolve();
      },
    }),
    resolveResidueProviderAccountId: () =>
      Promise.reject(new Error("oauth grants are not part of this test")),
    revokeOAuthGrant: () =>
      Promise.reject(new Error("oauth grants are not part of this test")),
    waitForRepairDeadline: (deadlineMs: number) => sleep(deadlineMs),
  } as unknown as Parameters<typeof createTeardownResidueReaper>[0]);

  return { abortedWhenCalled, contextArguments, deregisterCalls, reap };
};

describe("push repair signal reaches registrar context", () => {
  it("hands the registrar context builder a signal that aborts on the repair deadline", async () => {
    const harness = createHarness();

    const outcome = await harness.reap();

    expect(harness.contextArguments).toHaveLength(1);

    const [signal] = harness.contextArguments;

    expect(signal).toBeInstanceOf(AbortSignal);
    expect(harness.abortedWhenCalled).toEqual([false]);

    const abortSignal = signal as AbortSignal;

    expect(abortSignal.aborted).toBe(true);

    const reason = abortSignal.reason as { message?: string };

    expect(String(reason?.message ?? reason)).toContain("deadline");
    expect(outcome.failedIds).toEqual(["residue-push-1"]);

    await sleep(SETTLE_MS);

    expect(harness.deregisterCalls).toEqual([]);
  });
});
