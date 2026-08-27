import { describe, expect, it } from "vitest";
import { createTeardownResidueReaper } from "../../../src/core/deletion/teardown-residue-reaper";
import {
  OAUTH_GRANT_RESIDUE_KIND,
  PUSH_CHANNEL_RESIDUE_KIND,
} from "../../../src/core/deletion/teardown-residue";
import type {
  TeardownResidueRecord,
  TeardownResidueStore,
} from "../../../src/core/deletion/teardown-residue";
import { resolvePushRegistrar } from "../../../src/core/source/push-registry";
import type { RegistrarContext } from "../../../src/core/source/push-channel";

const NOW = new Date("2026-08-26T12:00:00.000Z");
const RECORDED_AT = new Date(NOW.getTime() - 60 * 60 * 1000);
const EXPIRES_AT = new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000);
const DELETED_USER_ID = "gone";
const UNSTOPPABLE_SLUG = "teardown-residue-unstoppable-without-resource-id";
const UNSTOPPABLE_REASON = "unstoppable_without_resource_id";

const pushResidue = (): TeardownResidueRecord => ({
  attempts: 0,
  createdAt: RECORDED_AT,
  expiresAt: EXPIRES_AT,
  id: "residue-push",
  kind: PUSH_CHANNEL_RESIDUE_KIND,
  provider: "google",
  providerChannelId: "channel-one",
  userId: DELETED_USER_ID,
});

const grantResidue = (): TeardownResidueRecord => ({
  accountEmail: "gone@example.com",
  attempts: 0,
  createdAt: RECORDED_AT,
  credential: {
    accessToken: "access-token-value",
    expiresAt: null,
    refreshToken: "refresh-token-value",
  },
  expiresAt: EXPIRES_AT,
  id: "residue-grant",
  kind: OAUTH_GRANT_RESIDUE_KIND,
  provider: "google",
  providerAccountId: "1099876543210",
  userId: DELETED_USER_ID,
});

const createHarness = () => {
  const clearedIds: string[] = [];
  const dialedUrls: string[] = [];
  const errors: { error: unknown; slug: string }[] = [];
  const observed: Record<string, unknown>[] = [];
  const revokedTokens: string[] = [];

  const registrarContext = (): RegistrarContext => ({
    accessToken: "access-token-value",
    channelId: null,
    fetchImpl: (input: string) => {
      dialedUrls.push(String(input));

      return Promise.reject(new Error(`the reaper dialed ${String(input)}`));
    },
    notificationUrl: "https://keeper.sh/webhooks/google",
    now: NOW,
    requestedExpiresAt: EXPIRES_AT,
  }) as RegistrarContext;

  const store: TeardownResidueStore = {
    clear: (residueId: string) => {
      clearedIds.push(residueId);

      return Promise.resolve();
    },
    deleteForUser: () => Promise.resolve(0),
    list: () => Promise.resolve([pushResidue(), grantResidue()]),
    purgeOrphaned: () => Promise.resolve([]),
    record: () => Promise.resolve(),
  };

  const reap = createTeardownResidueReaper({
    countSurvivingAccountLinks: () =>
      Promise.resolve({
        blockingCredentialIds: [],
        coHolders: 0,
        identityResolved: true,
      }),
    createRegistrarContext: () => Promise.resolve(registrarContext()),
    deletePolarCustomer: () => Promise.reject(new Error("polar is not part of this test")),
    now: () => NOW,
    observe: (fields: Record<string, unknown>) => {
      observed.push(fields);
    },
    recordError: (error: unknown, slug: string) => {
      errors.push({ error, slug });
    },
    repairDeadlineMs: 30_000,
    residue: store,
    resolveRegistrar: (provider: string) => resolvePushRegistrar(provider),
    revokeOAuthGrant: (_record: TeardownResidueRecord, token: string) => {
      revokedTokens.push(token);

      return Promise.resolve();
    },
    waitForRepairDeadline: () => new Promise<void>(() => {}),
  });

  return { clearedIds, dialedUrls, errors, observed, reap, revokedTokens };
};

describe("unstoppable push residue retires on the first reaper pass", () => {
  it("retires a google push residue with no resource id, reports it once, and never dials Google", async () => {
    const harness = createHarness();

    const outcome = await harness.reap();

    expect(harness.dialedUrls).toEqual([]);
    expect(outcome.expiredIds).toEqual(["residue-push"]);
    expect(outcome.failedIds).toEqual([]);
    expect(harness.clearedIds).toContain("residue-push");
    expect(harness.errors.map((entry) => entry.slug)).toEqual([UNSTOPPABLE_SLUG]);
    expect(harness.observed.at(0)?.["teardown_residue.retirement_reasons"]).toEqual({
      "residue-push": UNSTOPPABLE_REASON,
    });
  });

  it("stops deferring that user's oauth grant on the same pass", async () => {
    const harness = createHarness();

    const outcome = await harness.reap();

    expect(outcome.deferredIds).toEqual([]);
    expect(harness.revokedTokens).toEqual(["refresh-token-value"]);
    expect(outcome.clearedIds).toEqual(["residue-grant"]);
  });
});
