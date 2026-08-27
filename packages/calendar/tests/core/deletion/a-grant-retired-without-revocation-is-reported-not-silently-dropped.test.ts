import { describe, expect, it } from "vitest";
import {
  createTeardownResidueReaper,
  RESIDUE_IDENTITY_UNRESOLVED_SLUG,
  RESIDUE_REPAIR_FAILED_SLUG,
  RESIDUE_STALE_SLUG,
} from "../../../src/core/deletion/teardown-residue-reaper";
import { OAUTH_GRANT_RESIDUE_KIND } from "../../../src/core/deletion/teardown-residue";
import type {
  TeardownResidueRecord,
  TeardownResidueStore,
} from "../../../src/core/deletion/teardown-residue";

const NOW = new Date("2026-08-26T12:00:00.000Z");
const PAST = new Date("2026-07-30T12:00:00.000Z");
const ATTEMPTS_BEYOND_THE_REPAIR_CAP = 7;
const RETIRED_UNREVOKED_SLUG = "teardown-residue-retired-unrevoked";
const RETIRED_UNREVOKED_COUNT_FIELD = "teardown_residue.retired_unrevoked_count";

const unrevokedGrant: TeardownResidueRecord = {
  accountEmail: "deleted-customer@gmail.com",
  attempts: ATTEMPTS_BEYOND_THE_REPAIR_CAP,
  createdAt: new Date("2026-08-18T06:15:33.956Z"),
  credential: {
    accessToken: "stranded-access",
    expiresAt: null,
    refreshToken: "stranded-refresh",
  },
  expiresAt: PAST,
  id: "residue-unrevoked",
  kind: OAUTH_GRANT_RESIDUE_KIND,
  provider: "google",
  providerAccountId: "1099876543210",
  userId: "user-deleted",
};

const createHarness = (records: TeardownResidueRecord[]) => {
  const remaining = [...records];
  const clearedIds: string[] = [];
  const revokedTokens: string[] = [];
  const errors: { error: unknown; slug: string }[] = [];
  const observed: Record<string, unknown>[] = [];

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
  };

  const reap = createTeardownResidueReaper({
    countSurvivingAccountLinks: () =>
      Promise.resolve({ coHolders: 0, identityResolved: false }),
    createRegistrarContext: () =>
      Promise.reject(new Error("push channels are not part of this test")),
    deletePolarCustomer: () =>
      Promise.reject(new Error("polar is not part of this test")),
    now: () => NOW,
    observe: (fields: Record<string, unknown>) => {
      observed.push(fields);
    },
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

  return { clearedIds, errors, observed, reap, remaining, revokedTokens };
};

describe("a grant retired without revocation is reported, not silently dropped", () => {
  it("still clears and retires the residue it can no longer repair", async () => {
    const harness = createHarness([unrevokedGrant]);

    const outcome = await harness.reap();

    expect(harness.revokedTokens).toEqual([]);
    expect(outcome.expiredIds).toEqual(["residue-unrevoked"]);
    expect(outcome.unresolvedIds).toEqual([]);
    expect(harness.clearedIds).toEqual(["residue-unrevoked"]);
    expect(harness.remaining).toEqual([]);
  });

  it("reports the unrevoked retirement under its own slug, naming the user, the provider and the account", async () => {
    const harness = createHarness([unrevokedGrant]);

    await harness.reap();

    const reported = harness.errors.filter(
      (entry) => entry.slug === RETIRED_UNREVOKED_SLUG,
    );

    expect(reported).toHaveLength(1);
    expect(RETIRED_UNREVOKED_SLUG).not.toBe(RESIDUE_STALE_SLUG);
    expect(RETIRED_UNREVOKED_SLUG).not.toBe(RESIDUE_REPAIR_FAILED_SLUG);
    expect(RETIRED_UNREVOKED_SLUG).not.toBe(RESIDUE_IDENTITY_UNRESOLVED_SLUG);

    const message = String(
      (reported[0]?.error as { message?: unknown })?.message ?? reported[0]?.error,
    );

    expect(message).toContain("user-deleted");
    expect(message).toContain("google");
    expect(message).toContain("deleted-customer@gmail.com");
  });

  it("emits a distinct count of grants retired unrevoked on the pass that creates the exposure", async () => {
    const harness = createHarness([unrevokedGrant]);

    await harness.reap();

    expect(harness.observed).toHaveLength(1);
    expect(harness.observed[0]?.[RETIRED_UNREVOKED_COUNT_FIELD]).toBe(1);
    expect(harness.observed[0]?.["teardown_residue.hopeless_count"]).toBe(0);
    expect(harness.observed[0]?.["teardown_residue.expired_count"]).toBe(1);
  });
});
