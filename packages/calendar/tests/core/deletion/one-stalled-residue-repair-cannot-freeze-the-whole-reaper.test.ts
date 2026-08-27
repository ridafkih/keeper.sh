import { describe, expect, it } from "vitest";
import {
  createTeardownResidueReaper,
  RESIDUE_REPAIR_FAILED_SLUG,
} from "../../../src/core/deletion/teardown-residue-reaper";
import {
  OAUTH_GRANT_RESIDUE_KIND,
  POLAR_CUSTOMER_RESIDUE_KIND,
} from "../../../src/core/deletion/teardown-residue";
import type {
  TeardownResidueRecord,
  TeardownResidueStore,
} from "../../../src/core/deletion/teardown-residue";

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

const oauthGrantRecord = (): TeardownResidueRecord => ({
  accountEmail: "second@example.com",
  createdAt: new Date("2026-08-25T06:15:33.956Z"),
  credential: {
    accessToken: "user-2-access-token",
    expiresAt: null,
    refreshToken: "user-2-refresh-token",
  },
  expiresAt: FUTURE,
  externalId: "account-2",
  id: "residue-grant-2",
  kind: OAUTH_GRANT_RESIDUE_KIND,
  provider: "google",
  providerAccountId: "2099876543210",
  userId: "user-2",
});

const stalledRepair = (): Promise<never> => Promise.withResolvers<never>().promise;

const createHarness = () => {
  const clearedIds: string[] = [];
  const revocations: { token: string; userId: string }[] = [];
  const errors: { error: unknown; slug: string }[] = [];
  const deadlinesRequested: number[] = [];

  const store: TeardownResidueStore = {
    clear: (residueId: string) => {
      clearedIds.push(residueId);
      return Promise.resolve();
    },
    deleteForUser: () => Promise.resolve(0),
    list: () => Promise.resolve([stalledPolarRecord(), oauthGrantRecord()]),
    purgeOrphaned: () => Promise.resolve([]),
    record: () => Promise.resolve(),
    spendRepairAttempt: () => Promise.resolve(0),
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
    deletePolarCustomer: () => stalledRepair(),
    now: () => NOW,
    observe: () => undefined,
    recordError: (error: unknown, slug: string) => {
      errors.push({ error, slug });
    },
    repairDeadlineMs: REPAIR_DEADLINE_MS,
    residue: store,
    resolveRegistrar: () => null,
    revokeOAuthGrant: (record: TeardownResidueRecord, token: string) => {
      revocations.push({ token, userId: record.userId });
      return Promise.resolve();
    },
    waitForRepairDeadline: (deadlineMs: number) => {
      deadlinesRequested.push(deadlineMs);
      return Promise.resolve();
    },
  } as unknown as Parameters<typeof createTeardownResidueReaper>[0]);

  return { clearedIds, deadlinesRequested, errors, reap, revocations };
};

describe("one stalled residue repair cannot freeze the whole reaper", () => {
  it("abandons the hung polar repair on its deadline and still revokes the next user's grant", async () => {
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

    expect(harness.revocations).toEqual([
      { token: "user-2-refresh-token", userId: "user-2" },
    ]);
    expect(outcome.clearedIds).toEqual(["residue-grant-2"]);
    expect(harness.clearedIds).toEqual(["residue-grant-2"]);
    expect(outcome.failedIds).toEqual(["residue-polar-1"]);
    expect(outcome.clearedIds).not.toContain("residue-polar-1");
    expect(harness.deadlinesRequested).toEqual([REPAIR_DEADLINE_MS]);
    expect(harness.errors.map((entry) => entry.slug)).toEqual([
      RESIDUE_REPAIR_FAILED_SLUG,
    ]);
  });
});
