import { describe, expect, it } from "vitest";
import { createTeardownResidueReaper } from "../../../src/core/deletion/teardown-residue-reaper";
import {
  GOOGLE_REVOKE_URL,
  revokeGoogleGrant,
} from "../../../src/core/oauth/google";
import { OAUTH_GRANT_RESIDUE_KIND } from "../../../src/core/deletion/teardown-residue";
import type {
  TeardownResidueRecord,
  TeardownResidueStore,
} from "../../../src/core/deletion/teardown-residue";

const NOW = new Date("2026-08-26T12:00:00.000Z");
const FUTURE = new Date("2026-09-30T12:00:00.000Z");
const SECONDS_BEFORE_NOW = new Date(NOW.getTime() - 4000);
const AN_HOUR_BEFORE_NOW = new Date(NOW.getTime() - 3_600_000);

const oauthGrantRecord = (createdAt: Date): TeardownResidueRecord => ({
  accountEmail: "owner@example.com",
  createdAt,
  credential: {
    accessToken: "access-token-value",
    expiresAt: null,
    refreshToken: "refresh-token-value",
  },
  expiresAt: FUTURE,
  externalId: "account-1",
  id: "residue-1",
  kind: OAUTH_GRANT_RESIDUE_KIND,
  provider: "google",
  providerAccountId: "1099876543210",
  userId: "user-1",
});

const createReaper = (record: TeardownResidueRecord) => {
  const remaining = [record];
  const clearedIds: string[] = [];
  const postedTokens: string[] = [];
  const errors: { error: unknown; slug: string }[] = [];

  const store: TeardownResidueStore = {
    clear: (residueId: string) => {
      clearedIds.push(residueId);
      const index = remaining.findIndex((candidate) => candidate.id === residueId);

      if (index === -1) {
        throw new Error(`Residue ${residueId} was cleared twice`);
      }

      remaining.splice(index, 1);

      return Promise.resolve();
    },
    deleteForUser: () => Promise.resolve(0),
    list: () => Promise.resolve([...remaining]),
    purgeOrphaned: () => Promise.resolve([]),
    record: () => Promise.resolve(),
  };

  const fetchImpl = (input: string, init: RequestInit): Promise<Response> => {
    expect(input).toBe(GOOGLE_REVOKE_URL);
    postedTokens.push(new URLSearchParams(String(init.body)).get("token") ?? "");

    return Promise.resolve(new Response("", { status: 200 }));
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
    revokeOAuthGrant: async (_record: TeardownResidueRecord, token: string) => {
      const outcome = await revokeGoogleGrant(token, { fetchImpl });

      if (!outcome.revoked) {
        throw new Error(`Google refused to revoke the grant (${outcome.status})`);
      }
    },
  } as unknown as Parameters<typeof createTeardownResidueReaper>[0]);

  return { clearedIds, errors, postedTokens, reap, remaining };
};

describe("grant revocation waits out the window in which push residue is still in flight", () => {
  it("defers a grant recorded seconds ago, because the abandoned push channel residue may still be in flight", async () => {
    const harness = createReaper(oauthGrantRecord(SECONDS_BEFORE_NOW));

    const outcome = await harness.reap();

    expect(harness.postedTokens).toEqual([]);
    expect(outcome.deferredIds).toEqual(["residue-1"]);
    expect(outcome.clearedIds).toEqual([]);
    expect(outcome.failedIds).toEqual([]);
    expect(outcome.expiredIds).toEqual([]);
    expect(harness.clearedIds).toEqual([]);
    expect(harness.remaining.map((row) => row.id)).toEqual(["residue-1"]);
    expect(harness.errors).toEqual([]);
  });

  it("revokes a grant recorded an hour ago, proving the quiet period is a window and not a switch", async () => {
    const harness = createReaper(oauthGrantRecord(AN_HOUR_BEFORE_NOW));

    const outcome = await harness.reap();

    expect(harness.postedTokens).toEqual(["refresh-token-value"]);
    expect(outcome.deferredIds).toEqual([]);
    expect(outcome.clearedIds).toEqual(["residue-1"]);
    expect(harness.clearedIds).toEqual(["residue-1"]);
    expect(harness.remaining).toEqual([]);
    expect(harness.errors).toEqual([]);
  });
});
