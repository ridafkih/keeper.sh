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
const FIRST_ATTEMPT = 1;

const stallingGrantRecord = (): TeardownResidueRecord => ({
  accountEmail: "stalled@example.com",
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
  const capturedSignals: (AbortSignal | undefined)[] = [];

  const store: TeardownResidueStore = {
    clear: () => Promise.resolve(),
    deleteForUser: () => Promise.resolve(0),
    list: () => Promise.resolve([stallingGrantRecord()]),
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
    resolveResidueProviderAccountId: () => Promise.resolve("provider-account-1"),
    revokeOAuthGrant: (
      _record: TeardownResidueRecord,
      _token: string,
      signal?: AbortSignal,
    ) => {
      capturedSignals.push(signal);
      return new Promise<void>(() => {});
    },
    waitForRepairDeadline: (deadlineMs: number) => sleep(deadlineMs),
  } as unknown as Parameters<typeof createTeardownResidueReaper>[0]);

  return { capturedSignals, reap };
};

describe("an abandoned repair cancels the in-flight grant revocation", () => {
  it("aborts the revocation request when the repair is abandoned on its deadline", async () => {
    const harness = createHarness();

    const outcome = await harness.reap();

    expect(outcome.failedIds).toEqual(["residue-grant-1"]);
    expect(harness.capturedSignals).toHaveLength(1);

    const [signal] = harness.capturedSignals;

    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(true);
  });
});
