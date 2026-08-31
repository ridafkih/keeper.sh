import { describe, expect, it } from "vitest";
import {
  createTeardownResidueReaper,
  RESIDUE_REPAIR_FAILED_SLUG,
} from "../../../src/core/deletion/teardown-residue-reaper";
import { OAUTH_GRANT_RESIDUE_KIND } from "../../../src/core/deletion/teardown-residue";
import type {
  TeardownResidueRecord,
  TeardownResidueStore,
} from "../../../src/core/deletion/teardown-residue";

const NOW = new Date("2026-08-26T12:00:00.000Z");
const FUTURE = new Date("2026-09-30T12:00:00.000Z");
const PAST = new Date("2026-07-30T12:00:00.000Z");
const EXHAUSTED_ATTEMPTS = 6;

const unresolvedGrant: TeardownResidueRecord = {
  accountEmail: "shared@gmail.com",
  attempts: 0,
  createdAt: new Date("2026-08-25T06:15:33.956Z"),
  credential: {
    accessToken: "legacy-access",
    expiresAt: null,
    refreshToken: "legacy-refresh",
  },
  expiresAt: FUTURE,
  id: "residue-unresolved",
  kind: OAUTH_GRANT_RESIDUE_KIND,
  provider: "google",
  userId: "user-legacy",
};

const identifiedGrant: TeardownResidueRecord = {
  accountEmail: "identified@gmail.com",
  attempts: 0,
  createdAt: new Date("2026-08-25T06:15:33.956Z"),
  credential: {
    accessToken: "identified-access",
    expiresAt: null,
    refreshToken: "identified-refresh",
  },
  expiresAt: FUTURE,
  id: "residue-identified",
  kind: OAUTH_GRANT_RESIDUE_KIND,
  provider: "google",
  providerAccountId: "1099876543210",
  userId: "user-identified",
};

const coHeldGrant: TeardownResidueRecord = {
  ...identifiedGrant,
  accountEmail: "coheld@gmail.com",
  id: "residue-coheld",
  providerAccountId: "1055555555555",
  userId: "user-coheld",
};

const retiredUnresolvedGrant: TeardownResidueRecord = {
  ...unresolvedGrant,
  attempts: EXHAUSTED_ATTEMPTS,
  expiresAt: PAST,
  id: "residue-unresolved-retired",
};

const createHarness = (
  records: TeardownResidueRecord[],
  survivingAccountLinks = 0,
) => {
  const remaining = [...records];
  const clearedIds: string[] = [];
  const revokedTokens: string[] = [];
  const countedRecordIds: string[] = [];
  const errors: { error: unknown; slug: string }[] = [];

  const store: TeardownResidueStore = {
    clear: (residueId: string) => {
      clearedIds.push(residueId);

      const index = remaining.findIndex((record) => record.id === residueId);

      if (index !== -1) {
        remaining.splice(index, 1);
      }

      return Promise.resolve();
    },
    deleteForUser: () => Promise.resolve(0),
    list: () => Promise.resolve([...remaining]),
    purgeOrphaned: () => Promise.resolve([]),
    record: () => Promise.resolve(),
    spendRepairAttempt: (residueId: string) => {
      const claimed = remaining.find((candidate) => candidate.id === residueId);

      if (!claimed) {
        return Promise.reject(new Error(`residue ${residueId} is not in this batch`));
      }

      return Promise.resolve(claimed.attempts ?? 0);
    },
  };

  const reap = createTeardownResidueReaper({
    countSurvivingAccountLinks: (record: TeardownResidueRecord) => {
      countedRecordIds.push(record.id);
      return Promise.resolve({
        blockingCredentialIds: [],
        coHolders: survivingAccountLinks,
        identityResolved: true,
      });
    },
    createRegistrarContext: () =>
      Promise.reject(new Error("push channels are not part of this test")),
    deletePolarCustomer: () =>
      Promise.reject(new Error("polar is not part of this test")),
    now: () => NOW,
    observe: () => undefined,
    recordError: (error: unknown, slug: string) => {
      errors.push({ error, slug });
    },
    residue: store,
    resolveRegistrar: () => null,
    revokeOAuthGrant: (_record: TeardownResidueRecord, token: string) => {
      revokedTokens.push(token);
      return Promise.resolve();
    },
  } as unknown as Parameters<typeof createTeardownResidueReaper>[0]);

  return { clearedIds, countedRecordIds, errors, reap, remaining, revokedTokens };
};

describe("oauth residue whose provider account identity cannot be resolved keeps its residue", () => {
  it("does not revoke and does not clear a grant carrying no provider account id", async () => {
    const harness = createHarness([unresolvedGrant]);

    const outcome = await harness.reap();

    expect(harness.revokedTokens).toEqual([]);
    expect(harness.clearedIds).toEqual([]);
    expect(harness.remaining.map((record) => record.id)).toEqual([
      "residue-unresolved",
    ]);
    expect(outcome.clearedIds).toEqual([]);
    expect(outcome.revocationSkippedIds).toEqual([]);
    expect(outcome.unresolvedIds).toEqual(["residue-unresolved"]);
  });

  it("reports the unresolved identity through recordError under its own slug", async () => {
    const harness = createHarness([unresolvedGrant]);

    await harness.reap();

    expect(harness.errors).toHaveLength(1);
    expect(harness.errors[0]?.slug).toBe("teardown-residue-identity-unresolved");
    expect(harness.errors[0]?.slug).not.toBe(RESIDUE_REPAIR_FAILED_SLUG);
  });

  it("still clears and still reports a skip when a co-holder is positively identified", async () => {
    const harness = createHarness([coHeldGrant], 1);

    const outcome = await harness.reap();

    expect(harness.countedRecordIds).toEqual(["residue-coheld"]);
    expect(harness.revokedTokens).toEqual([]);
    expect(outcome.revocationSkippedIds).toEqual(["residue-coheld"]);
    expect(outcome.clearedIds).toEqual(["residue-coheld"]);
    expect(outcome.unresolvedIds).toEqual([]);
    expect(harness.remaining).toEqual([]);
  });

  it("still revokes a grant that carries a provider account id, checking co-holders first", async () => {
    const harness = createHarness([identifiedGrant]);

    const outcome = await harness.reap();

    expect(harness.countedRecordIds).toEqual(["residue-identified"]);
    expect(harness.revokedTokens).toEqual(["identified-refresh"]);
    expect(outcome.clearedIds).toEqual(["residue-identified"]);
    expect(outcome.revocationSkippedIds).toEqual([]);
    expect(outcome.unresolvedIds).toEqual([]);
  });

  it("retires an unresolved grant only once it is past expiry with its attempts exhausted", async () => {
    const harness = createHarness([retiredUnresolvedGrant]);

    const outcome = await harness.reap();

    expect(harness.revokedTokens).toEqual([]);
    expect(outcome.expiredIds).toEqual(["residue-unresolved-retired"]);
    expect(outcome.unresolvedIds).toEqual([]);
    expect(harness.remaining).toEqual([]);
  });
});
