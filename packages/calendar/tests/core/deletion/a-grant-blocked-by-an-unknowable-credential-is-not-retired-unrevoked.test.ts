import { describe, expect, it } from "vitest";
import {
  createTeardownResidueReaper,
  RESIDUE_GRANT_RETIRED_UNREVOKED_SLUG,
  RESIDUE_IDENTITY_UNRESOLVED_SLUG,
} from "../../../src/core/deletion/teardown-residue-reaper";
import { OAUTH_GRANT_RESIDUE_KIND } from "../../../src/core/deletion/teardown-residue";
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
const LONG_PAST = new Date("2026-04-01T12:00:00.000Z");
const FUTURE = new Date("2026-09-30T12:00:00.000Z");
const PERMANENT_FAILURE_ATTEMPT_CAP = 24;
const BLOCKING_CREDENTIAL_ID = "blocker-1";

const cappedOAuthRecord = (
  overrides: Partial<TeardownResidueRecord> = {},
): TeardownResidueRecord => ({
  accountEmail: "owner@example.com",
  attempts: PERMANENT_FAILURE_ATTEMPT_CAP,
  createdAt: new Date("2026-03-01T06:15:33.956Z"),
  credential: {
    accessToken: "access-token-value",
    expiresAt: null,
    refreshToken: "refresh-token-value",
  },
  expiresAt: LONG_PAST,
  id: "residue-oauth",
  kind: OAUTH_GRANT_RESIDUE_KIND,
  provider: "google",
  providerAccountId: "1099876543210",
  userId: "user-oauth",
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
    spendRepairAttempt: (residueId: string) => {
      const claimed = rows.get(residueId);

      if (!claimed) {
        return Promise.reject(new Error(`residue ${residueId} is not in this batch`));
      }

      return Promise.resolve(claimed.attempts ?? 0);
    },
  };

  return { rows, store };
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

const createReaper = (
  seed: TeardownResidueRecord[],
  census: {
    blockingCredentialIds: string[];
    coHolders: number;
    identityResolved: boolean;
  },
) => {
  const { rows, store } = createStore(seed);
  const revokedTokens: string[] = [];
  const errors: { error: unknown; slug: string }[] = [];
  const registrar = createRegistrar();

  const reap = createTeardownResidueReaper({
    countSurvivingAccountLinks: () => Promise.resolve(census),
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
    revokeOAuthGrant: (_record: TeardownResidueRecord, token: string) => {
      revokedTokens.push(token);
      return Promise.resolve();
    },
  } as unknown as Parameters<typeof createTeardownResidueReaper>[0]);

  return { errors, reap, revokedTokens, rows };
};

const blockedCensus = {
  blockingCredentialIds: [BLOCKING_CREDENTIAL_ID],
  coHolders: 0,
  identityResolved: false,
};

describe("a grant blocked by an unknowable credential is not retired unrevoked", () => {
  it("leaves an expired capped residue pending instead of retiring it unrevoked", async () => {
    const harness = createReaper([cappedOAuthRecord()], blockedCensus);

    const outcome = await harness.reap();

    expect(outcome.retiredUnrevokedIds).toEqual([]);
    expect(outcome.expiredIds).toEqual([]);
    expect([...harness.rows.keys()]).toEqual(["residue-oauth"]);
    expect(harness.revokedTokens).toEqual([]);
  });

  it("keeps reporting the blocking credential ids for the operator", async () => {
    const harness = createReaper([cappedOAuthRecord()], blockedCensus);

    const outcome = await harness.reap();

    expect(outcome.blockingCredentialIds).toContain(BLOCKING_CREDENTIAL_ID);
    expect(outcome.unresolvedIds).toEqual(["residue-oauth"]);
    expect(
      harness.errors.filter(
        (entry) => entry.slug === RESIDUE_IDENTITY_UNRESOLVED_SLUG,
      ),
    ).toHaveLength(1);
    expect(
      harness.errors.some(
        (entry) => entry.slug === RESIDUE_GRANT_RETIRED_UNREVOKED_SLUG,
      ),
    ).toBe(false);
  });

  it("still retires an unresolved residue that names no blocking credential", async () => {
    const harness = createReaper([cappedOAuthRecord()], {
      blockingCredentialIds: [],
      coHolders: 0,
      identityResolved: false,
    });

    const outcome = await harness.reap();

    expect(outcome.retiredUnrevokedIds).toEqual(["residue-oauth"]);
    expect(outcome.expiredIds).toContain("residue-oauth");
    expect([...harness.rows.keys()]).toEqual([]);
  });
});
