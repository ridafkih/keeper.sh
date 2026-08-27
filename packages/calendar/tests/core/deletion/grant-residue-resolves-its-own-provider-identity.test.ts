import { describe, expect, it } from "vitest";
import {
  createTeardownResidueReaper,
  RESIDUE_IDENTITY_UNRESOLVED_SLUG,
  RESIDUE_REPAIR_FAILED_SLUG,
} from "../../../src/core/deletion/teardown-residue-reaper";
import { OAUTH_GRANT_RESIDUE_KIND } from "../../../src/core/deletion/teardown-residue";
import type {
  TeardownResidueRecord,
  TeardownResidueStore,
} from "../../../src/core/deletion/teardown-residue";

const NOW = new Date("2026-08-26T12:00:00.000Z");
const FUTURE = new Date("2026-09-30T12:00:00.000Z");
const RESOLVED_PROVIDER_ACCOUNT_ID = "104839271056483920174";

const legacyGrant: TeardownResidueRecord = {
  accountEmail: "deleted@gmail.com",
  attempts: 0,
  createdAt: new Date("2026-08-25T06:15:33.956Z"),
  credential: {
    accessToken: "legacy-access",
    expiresAt: null,
    refreshToken: "legacy-refresh",
  },
  expiresAt: FUTURE,
  id: "residue-legacy-identity",
  kind: OAUTH_GRANT_RESIDUE_KIND,
  provider: "google",
  userId: "user-legacy",
};

const createHarness = (records: TeardownResidueRecord[]) => {
  const remaining = [...records];
  const clearedIds: string[] = [];
  const revokedTokens: string[] = [];
  const censusRecords: TeardownResidueRecord[] = [];
  const resolvedForIds: string[] = [];

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
    countSurvivingAccountLinks: (record: TeardownResidueRecord) => {
      censusRecords.push(record);

      return Promise.resolve({
        blockingCredentialIds: [],
        coHolders: 0,
        identityResolved: true,
      });
    },
    createRegistrarContext: () =>
      Promise.reject(new Error("push channels are not part of this test")),
    deletePolarCustomer: () =>
      Promise.reject(new Error("polar is not part of this test")),
    now: () => NOW,
    observe: () => undefined,
    recordError: () => undefined,
    residue: store,
    resolveRegistrar: () => null,
    resolveResidueProviderAccountId: (record: TeardownResidueRecord) => {
      resolvedForIds.push(record.id);

      return Promise.resolve(RESOLVED_PROVIDER_ACCOUNT_ID);
    },
    revokeOAuthGrant: (_record: TeardownResidueRecord, token: string) => {
      revokedTokens.push(token);

      return Promise.resolve();
    },
  } as unknown as Parameters<typeof createTeardownResidueReaper>[0]);

  return { censusRecords, clearedIds, reap, remaining, resolvedForIds, revokedTokens };
};

describe("grant residue resolves its own provider identity", () => {
  it("asks the resolver for the identity a legacy residue never recorded", async () => {
    const harness = createHarness([legacyGrant]);

    await harness.reap();

    expect(harness.resolvedForIds).toEqual(["residue-legacy-identity"]);
  });

  it("hands the census the resolved provider account id", async () => {
    const harness = createHarness([legacyGrant]);

    await harness.reap();

    expect(
      harness.censusRecords.map((record) => record.providerAccountId),
    ).toEqual([RESOLVED_PROVIDER_ACCOUNT_ID]);
  });

  it("revokes the grant with the residue's refresh token and clears the residue", async () => {
    const harness = createHarness([legacyGrant]);

    const outcome = await harness.reap();

    expect(harness.revokedTokens).toEqual(["legacy-refresh"]);
    expect(outcome.clearedIds).toEqual(["residue-legacy-identity"]);
    expect(outcome.unresolvedIds).toEqual([]);
    expect(harness.remaining).toEqual([]);
  });
});

const createBrownoutHarness = (records: TeardownResidueRecord[]) => {
  const remaining = [...records];
  const clearedIds: string[] = [];
  const revokedTokens: string[] = [];
  const recordedErrors: { error: unknown; slug: string }[] = [];

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
      Promise.reject(
        new Error("the census must not be reached when identity is unresolvable"),
      ),
    createRegistrarContext: () =>
      Promise.reject(new Error("push channels are not part of this test")),
    deletePolarCustomer: () =>
      Promise.reject(new Error("polar is not part of this test")),
    now: () => NOW,
    observe: () => undefined,
    recordError: (error: unknown, slug: string) => {
      recordedErrors.push({ error, slug });
    },
    residue: store,
    resolveRegistrar: () => null,
    resolveResidueProviderAccountId: () =>
      Promise.reject(
        new Error("Google userinfo responded 503 Service Unavailable"),
      ),
    revokeOAuthGrant: (_record: TeardownResidueRecord, token: string) => {
      revokedTokens.push(token);

      return Promise.resolve();
    },
  } as unknown as Parameters<typeof createTeardownResidueReaper>[0]);

  return { clearedIds, reap, recordedErrors, remaining, revokedTokens };
};

describe("unresolvable residue identity defers instead of burning an attempt", () => {
  it("leaves the residue and its refresh token in place when the resolver rejects", async () => {
    const harness = createBrownoutHarness([legacyGrant]);

    const outcome = await harness.reap();

    expect(harness.revokedTokens).toEqual([]);
    expect(harness.clearedIds).toEqual([]);
    expect(harness.remaining).toEqual([legacyGrant]);
    expect(outcome.unresolvedIds).toEqual(["residue-legacy-identity"]);
    expect(outcome.failedIds).toEqual([]);
  });

  it("reports the brownout under the identity-unresolved slug", async () => {
    const harness = createBrownoutHarness([legacyGrant]);

    await harness.reap();

    expect(harness.recordedErrors.map(({ slug }) => slug)).toContain(
      RESIDUE_IDENTITY_UNRESOLVED_SLUG,
    );
    expect(harness.recordedErrors.map(({ slug }) => slug)).not.toContain(
      RESIDUE_REPAIR_FAILED_SLUG,
    );
  });
});
