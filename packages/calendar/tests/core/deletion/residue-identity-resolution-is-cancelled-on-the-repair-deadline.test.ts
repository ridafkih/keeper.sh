import { describe, expect, it } from "vitest";
import { createTeardownResidueReaper } from "../../../src/core/deletion/teardown-residue-reaper";
import { OAUTH_GRANT_RESIDUE_KIND } from "../../../src/core/deletion/teardown-residue";
import type {
  TeardownResidueRecord,
  TeardownResidueStore,
} from "../../../src/core/deletion/teardown-residue";

const NOW = new Date("2026-08-26T12:00:00.000Z");
const FUTURE = new Date("2026-09-30T12:00:00.000Z");
const RECORDED_AT = new Date("2026-08-26T11:00:00.000Z");
const REPAIR_DEADLINE_MS = 50;
const SETTLE_MS = 200;
const FIRST_ATTEMPT = 1;

const slowGrantRecord = (): TeardownResidueRecord => ({
  accountEmail: "slow@example.com",
  createdAt: RECORDED_AT,
  credential: {
    accessToken: "access-token",
    expiresAt: null,
    refreshToken: "refresh-token",
  },
  expiresAt: FUTURE,
  externalId: "account-1",
  id: "residue-grant-1",
  kind: OAUTH_GRANT_RESIDUE_KIND,
  provider: "google",
  userId: "user-1",
});

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const createHarness = () => {
  const revocations: string[] = [];
  const observedSignals: unknown[] = [];
  const abortedWhenCalled: boolean[] = [];

  const store: TeardownResidueStore = {
    clear: () => Promise.resolve(),
    deleteForUser: () => Promise.resolve(0),
    list: () => Promise.resolve([slowGrantRecord()]),
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
    createRegistrarContext: () =>
      Promise.reject(new Error("push channels are not part of this test")),
    deletePolarCustomer: () =>
      Promise.reject(new Error("polar customers are not part of this test")),
    now: () => NOW,
    observe: () => undefined,
    recordError: () => undefined,
    repairDeadlineMs: REPAIR_DEADLINE_MS,
    residue: store,
    resolveRegistrar: () => null,
    resolveResidueProviderAccountId: (
      _record: TeardownResidueRecord,
      signal: unknown,
    ) => {
      observedSignals.push(signal);
      abortedWhenCalled.push(
        signal instanceof AbortSignal ? signal.aborted : false,
      );

      return new Promise<string | null>((resolve) => {
        if (signal instanceof AbortSignal) {
          signal.addEventListener("abort", () => resolve(null));
        }
      });
    },
    revokeOAuthGrant: (_record: TeardownResidueRecord, token: string) => {
      revocations.push(token);
      return Promise.resolve();
    },
    waitForRepairDeadline: (deadlineMs: number) => sleep(deadlineMs),
  } as unknown as Parameters<typeof createTeardownResidueReaper>[0]);

  return { abortedWhenCalled, observedSignals, reap, revocations };
};

describe("residue identity resolution is cancelled on the repair deadline", () => {
  it("hands the identity resolver a signal that aborts when the repair is abandoned", async () => {
    const harness = createHarness();

    const outcome = await harness.reap();

    expect(harness.observedSignals).toHaveLength(1);

    const [signal] = harness.observedSignals;

    expect(signal).toBeInstanceOf(AbortSignal);
    expect(harness.abortedWhenCalled).toEqual([false]);

    const abortSignal = signal as AbortSignal;

    expect(abortSignal.aborted).toBe(true);

    const reason = abortSignal.reason as { message?: string };

    expect(String(reason?.message ?? reason)).toContain("deadline");
    expect(outcome.failedIds).toEqual(["residue-grant-1"]);

    await sleep(SETTLE_MS);

    expect(harness.revocations).toEqual([]);
  });
});
