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
const SLOW_IDENTITY_RESOLUTION_MS = 400;
const PAST_THE_SLOW_RESOLUTION_MS = 800;
const FIRST_ATTEMPT = 1;

const abandonedGrantRecord = (): TeardownResidueRecord => ({
  accountEmail: "abandoned@example.com",
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
  const attemptsSpent: string[] = [];

  const store: TeardownResidueStore = {
    clear: () => Promise.resolve(),
    deleteForUser: () => Promise.resolve(0),
    list: () => Promise.resolve([abandonedGrantRecord()]),
    purgeOrphaned: () => Promise.resolve([]),
    record: () => Promise.resolve(),
    spendRepairAttempt: (residueId: string) => {
      attemptsSpent.push(residueId);
      return Promise.resolve(FIRST_ATTEMPT);
    },
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
    resolveResidueProviderAccountId: () =>
      new Promise<string>((resolve) => {
        setTimeout(() => resolve("provider-account-1"), SLOW_IDENTITY_RESOLUTION_MS);
      }),
    revokeOAuthGrant: (_record: TeardownResidueRecord, token: string) => {
      revocations.push(token);
      return Promise.resolve();
    },
    waitForRepairDeadline: (deadlineMs: number) => sleep(deadlineMs),
  } as unknown as Parameters<typeof createTeardownResidueReaper>[0]);

  return { attemptsSpent, reap, revocations };
};

describe("an abandoned residue repair never revokes the grant", () => {
  it("does not let the abandoned continuation revoke the grant after the deadline", async () => {
    const harness = createHarness();

    const outcome = await harness.reap();

    expect(outcome.failedIds).toEqual(["residue-grant-1"]);
    expect(harness.revocations).toEqual([]);
    expect(harness.attemptsSpent).toEqual(["residue-grant-1"]);

    await sleep(PAST_THE_SLOW_RESOLUTION_MS);

    expect(harness.revocations).toEqual([]);
    expect(outcome.failedIds).toEqual(["residue-grant-1"]);
    expect(harness.attemptsSpent).toEqual(["residue-grant-1"]);
  });
});
