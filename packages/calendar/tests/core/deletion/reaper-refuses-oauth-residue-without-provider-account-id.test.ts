import { describe, expect, it } from "vitest";
import { createTeardownResidueReaper } from "../../../src/core/deletion/teardown-residue-reaper";
import { OAUTH_GRANT_RESIDUE_KIND } from "../../../src/core/deletion/teardown-residue";
import type {
  TeardownResidueRecord,
  TeardownResidueStore,
} from "../../../src/core/deletion/teardown-residue";

const NOW = new Date("2026-08-26T12:00:00.000Z");
const FUTURE = new Date("2026-09-30T12:00:00.000Z");

const legacyGrant: TeardownResidueRecord = {
  accountEmail: "shared@gmail.com",
  createdAt: new Date("2026-08-25T06:15:33.956Z"),
  credential: {
    accessToken: "legacy-access",
    expiresAt: null,
    refreshToken: "legacy-refresh",
  },
  expiresAt: FUTURE,
  id: "residue-legacy",
  kind: OAUTH_GRANT_RESIDUE_KIND,
  provider: "google",
  userId: "user-legacy",
};

const identifiedGrant: TeardownResidueRecord = {
  accountEmail: "identified@gmail.com",
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

const createHarness = (records: TeardownResidueRecord[]) => {
  const remaining = [...records];
  const revokedRecordIds: string[] = [];
  const countedRecordIds: string[] = [];
  const errors: { error: unknown; slug: string }[] = [];

  const store: TeardownResidueStore = {
    clear: (residueId: string) => {
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
  };

  const reap = createTeardownResidueReaper({
    countSurvivingAccountLinks: (record: TeardownResidueRecord) => {
      countedRecordIds.push(record.id);
      return Promise.resolve(0);
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
    revokeOAuthGrant: (record: TeardownResidueRecord) => {
      revokedRecordIds.push(record.id);
      return Promise.resolve();
    },
  } as unknown as Parameters<typeof createTeardownResidueReaper>[0]);

  return { countedRecordIds, errors, reap, remaining, revokedRecordIds };
};

describe("reaper refuses to revoke oauth residue that carries no provider account id", () => {
  it("skips revocation for a legacy grant identified only by email and clears the row", async () => {
    const harness = createHarness([legacyGrant]);

    const outcome = await harness.reap();

    expect(harness.revokedRecordIds).toEqual([]);
    expect(outcome.revocationSkippedIds).toEqual(["residue-legacy"]);
    expect(outcome.clearedIds).toEqual(["residue-legacy"]);
    expect(outcome.failedIds).toEqual([]);
    expect(harness.remaining).toEqual([]);
  });

  it("still revokes a grant that carries a provider account id, checking co-holders first", async () => {
    const harness = createHarness([identifiedGrant]);

    const outcome = await harness.reap();

    expect(harness.countedRecordIds).toEqual(["residue-identified"]);
    expect(harness.revokedRecordIds).toEqual(["residue-identified"]);
    expect(outcome.clearedIds).toEqual(["residue-identified"]);
    expect(outcome.revocationSkippedIds).toEqual([]);
  });
});
