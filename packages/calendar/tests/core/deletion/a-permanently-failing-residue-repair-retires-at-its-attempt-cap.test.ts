import { describe, expect, it } from "vitest";
import { createTeardownResidueReaper } from "../../../src/core/deletion/teardown-residue-reaper";
import {
  GOOGLE_REVOKE_URL,
  revokeGoogleGrant,
} from "../../../src/core/oauth/google";
import {
  OAUTH_GRANT_RESIDUE_KIND,
  PUSH_CHANNEL_RESIDUE_KIND,
} from "../../../src/core/deletion/teardown-residue";
import type {
  TeardownResidueRecord,
  TeardownResidueStore,
} from "../../../src/core/deletion/teardown-residue";
import type {
  RegistrarContext,
  SourcePushRegistrar,
  StoredPushChannel,
} from "../../../src/core/source/push-channel";

const NOW = new Date("2026-08-26T12:00:00.000Z");
const FUTURE = new Date("2026-09-30T12:00:00.000Z");
const INVALID_TOKEN_BODY = JSON.stringify({ error: "invalid_token" });
const PERMANENT_FAILURE_ATTEMPT_CAP = 24;
const ATTEMPTS_BELOW_THE_CAP = 6;

const failingOAuthRecord = (
  overrides: Partial<TeardownResidueRecord> = {},
): TeardownResidueRecord => ({
  accountEmail: "owner@example.com",
  attempts: PERMANENT_FAILURE_ATTEMPT_CAP,
  createdAt: new Date("2026-08-18T06:15:33.956Z"),
  credential: {
    accessToken: "access-token-value",
    expiresAt: null,
    refreshToken: "refresh-token-value",
  },
  expiresAt: FUTURE,
  id: "residue-oauth",
  kind: OAUTH_GRANT_RESIDUE_KIND,
  provider: "google",
  providerAccountId: "1099876543210",
  userId: "user-oauth",
  ...overrides,
});

const unrepairablePushRecord = (
  overrides: Partial<TeardownResidueRecord> = {},
): TeardownResidueRecord => ({
  attempts: PERMANENT_FAILURE_ATTEMPT_CAP,
  createdAt: new Date("2026-08-18T06:15:33.956Z"),
  expiresAt: FUTURE,
  id: "residue-push",
  kind: PUSH_CHANNEL_RESIDUE_KIND,
  provider: "google",
  providerResourceId: "resource-1",
  userId: "user-push",
  ...overrides,
});

const createStore = (seed: TeardownResidueRecord[]) => {
  const rows = new Map(seed.map((record) => [record.id, record]));
  const store: TeardownResidueStore = {
    clear: (residueId: string) => {
      rows.delete(residueId);
      return Promise.resolve();
    },
    deleteForUser: () => Promise.resolve(0),
    list: () => Promise.resolve([...rows.values()]),
    purgeOrphaned: () => Promise.resolve([]),
    record: () => Promise.resolve(),
  };

  return { rows, store };
};

const invalidTokenFetch = (input: string): Promise<Response> => {
  expect(input).toBe(GOOGLE_REVOKE_URL);
  return Promise.resolve(new Response(INVALID_TOKEN_BODY, { status: 400 }));
};

const registrarContext = (): RegistrarContext => ({
  accessToken: "access-token-value",
  channelId: null,
  fetchImpl: globalThis.fetch,
  notificationUrl: "https://keeper.sh/webhooks/google",
  now: NOW,
  requestedExpiresAt: FUTURE,
});

const createRegistrar = (): SourcePushRegistrar =>
  ({
    deregister: (_channel: StoredPushChannel) => Promise.resolve(),
    maxLifetimeMs: 604_800_000,
    provider: "google",
    register: () => Promise.reject(new Error("register is not part of this test")),
    renew: () => Promise.reject(new Error("renew is not part of this test")),
    renewalMode: "renew",
    resolveAffectedCalendarIds: () => Promise.resolve([]),
    scopeKind: "account",
  }) as unknown as SourcePushRegistrar;

const createReaper = (seed: TeardownResidueRecord[]) => {
  const { rows, store } = createStore(seed);
  const revokedTokens: string[] = [];
  const errors: { error: unknown; slug: string }[] = [];
  const registrar = createRegistrar();

  const reap = createTeardownResidueReaper({
    countSurvivingAccountLinks: () =>
      Promise.resolve({ coHolders: 0, identityResolved: true }),
    createRegistrarContext: () => Promise.resolve(registrarContext()),
    deletePolarCustomer: () =>
      Promise.reject(new Error("polar is not part of this test")),
    now: () => NOW,
    observe: () => undefined,
    recordError: (error: unknown, slug: string) => {
      errors.push({ error, slug });
    },
    residue: store,
    resolveRegistrar: (provider: string) => (provider === "google" ? registrar : null),
    revokeOAuthGrant: async (record: TeardownResidueRecord, token: string) => {
      revokedTokens.push(token);
      const outcome = await revokeGoogleGrant(token, { fetchImpl: invalidTokenFetch });

      if (!outcome.revoked) {
        throw new Error(
          `Google refused to revoke the grant behind residue ${record.id} `
            + `(${outcome.status}): ${outcome.body}`,
        );
      }
    },
  } as unknown as Parameters<typeof createTeardownResidueReaper>[0]);

  return { errors, reap, revokedTokens, rows };
};

describe("a permanently failing residue repair retires at its attempt cap", () => {
  it("retires an oauth grant residue at the attempt cap even though its expiry is in the future", async () => {
    const harness = createReaper([failingOAuthRecord()]);

    const outcome = await harness.reap();

    expect(outcome.expiredIds).toContain("residue-oauth");
    expect(outcome.failedIds).toEqual([]);
    expect([...harness.rows.keys()]).toEqual([]);
  });

  it("stops re-posting a capped revocation to the provider on later passes", async () => {
    const harness = createReaper([failingOAuthRecord()]);

    await harness.reap();
    const second = await harness.reap();

    expect(harness.revokedTokens).toEqual(["refresh-token-value"]);
    expect(second.scannedCount).toBe(0);
  });

  it("retires a push residue whose repair can never succeed once it reaches the cap", async () => {
    const harness = createReaper([unrepairablePushRecord()]);

    const outcome = await harness.reap();

    expect(outcome.expiredIds).toContain("residue-push");
    expect(outcome.failedIds).toEqual([]);
    expect([...harness.rows.keys()]).toEqual([]);
  });

  it("keeps retrying a failing residue below the cap whose expiry is still in the future", async () => {
    const harness = createReaper([
      failingOAuthRecord({ attempts: ATTEMPTS_BELOW_THE_CAP }),
    ]);

    const outcome = await harness.reap();

    expect(outcome.failedIds).toEqual(["residue-oauth"]);
    expect(outcome.expiredIds).toEqual([]);
    expect([...harness.rows.keys()]).toEqual(["residue-oauth"]);
  });
});
