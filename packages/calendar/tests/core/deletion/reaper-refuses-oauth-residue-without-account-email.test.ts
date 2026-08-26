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

const anonymousGrant: TeardownResidueRecord = {
  createdAt: new Date("2026-08-25T06:15:33.956Z"),
  credential: {
    accessToken: "access-A",
    expiresAt: null,
    refreshToken: "refresh-A",
  },
  expiresAt: FUTURE,
  id: "residue-anonymous",
  kind: OAUTH_GRANT_RESIDUE_KIND,
  provider: "google",
  userId: "user-anonymous",
};

const namedGrant: TeardownResidueRecord = {
  accountEmail: "named@example.com",
  createdAt: new Date("2026-08-25T06:15:33.956Z"),
  credential: {
    accessToken: "access-B",
    expiresAt: null,
    refreshToken: "refresh-B",
  },
  expiresAt: FUTURE,
  id: "residue-named",
  kind: OAUTH_GRANT_RESIDUE_KIND,
  provider: "google",
  providerAccountId: "1099876543211",
  userId: "user-named",
};

const createHarness = (records: TeardownResidueRecord[]) => {
  const remaining = [...records];
  const revokedTokens: string[] = [];
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
    countSurvivingAccountLinks: () =>
      Promise.resolve({ coHolders: 0, identityResolved: true }),
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

  return { errors, reap, remaining, revokedTokens };
};

describe("reaper refuses to revoke oauth residue that names no google account", () => {
  it("never hands a nameless grant to revokeOAuthGrant, keeps the row, and fails it loudly", async () => {
    const harness = createHarness([anonymousGrant, namedGrant]);

    const outcome = await harness.reap();

    expect(harness.revokedTokens).toEqual(["refresh-B"]);
    expect(outcome.failedIds).toEqual(["residue-anonymous"]);
    expect(outcome.clearedIds).toEqual(["residue-named"]);
    expect(harness.remaining.map((record) => record.id)).toEqual([
      "residue-anonymous",
    ]);
    expect(harness.errors.map((entry) => entry.slug)).toEqual([
      RESIDUE_REPAIR_FAILED_SLUG,
    ]);
  });

  it("still revokes the companion grant that does name its account", async () => {
    const harness = createHarness([anonymousGrant, namedGrant]);

    const outcome = await harness.reap();

    expect(harness.revokedTokens).toContain("refresh-B");
    expect(harness.revokedTokens).not.toContain("refresh-A");
    expect(outcome.clearedIds).toContain("residue-named");
  });
});
