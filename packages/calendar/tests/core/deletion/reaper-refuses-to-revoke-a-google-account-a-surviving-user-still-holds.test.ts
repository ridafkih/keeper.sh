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
const SHARED_ACCOUNT = "bob@gmail.com";
const DELETED_USER_TOKEN = "deleted-user-refresh-token";
const SURVIVING_USER_TOKEN = "surviving-user-refresh-token";

const createGoogleGrantEndpoint = () => {
  const accountByToken = new Map<string, string>([
    [DELETED_USER_TOKEN, SHARED_ACCOUNT],
    [SURVIVING_USER_TOKEN, SHARED_ACCOUNT],
  ]);
  const revokedAccounts = new Set<string>();
  const postedTokens: string[] = [];

  const fetchImpl = (input: string, init: RequestInit): Promise<Response> => {
    expect(input).toBe(GOOGLE_REVOKE_URL);
    const token = new URLSearchParams(String(init.body)).get("token") ?? "";
    postedTokens.push(token);

    const account = accountByToken.get(token);

    if (!account) {
      return Promise.resolve(new Response("invalid_token", { status: 400 }));
    }

    revokedAccounts.add(account);
    return Promise.resolve(new Response("", { status: 200 }));
  };

  const isTokenLive = (token: string): boolean => {
    const account = accountByToken.get(token);

    if (!account) {
      throw new Error(`Token ${token} was never issued by the fake grant endpoint`);
    }

    return !revokedAccounts.has(account);
  };

  return { fetchImpl, isTokenLive, postedTokens };
};

const oauthGrantRecord = (): TeardownResidueRecord => ({
  accountEmail: SHARED_ACCOUNT,
  createdAt: new Date("2026-08-26T11:00:00.000Z"),
  credential: {
    accessToken: "deleted-user-access-token",
    expiresAt: null,
    refreshToken: DELETED_USER_TOKEN,
  },
  expiresAt: FUTURE,
  id: "residue-oauth-1",
  kind: OAUTH_GRANT_RESIDUE_KIND,
  provider: "google",
  userId: "deleted-user",
});

const createHarness = (survivingAccountLinks: number) => {
  const endpoint = createGoogleGrantEndpoint();
  const records = [oauthGrantRecord()];
  const clearedIds: string[] = [];
  const countedFor: { accountEmail?: string; provider?: string }[] = [];
  const errors: { error: unknown; slug: string }[] = [];
  const observed: Record<string, unknown>[] = [];

  const store: TeardownResidueStore = {
    clear: (residueId: string) => {
      clearedIds.push(residueId);
      return Promise.resolve();
    },
    deleteForUser: () => Promise.resolve(0),
    list: () => Promise.resolve(records),
    record: () => Promise.resolve(),
  };

  const reap = createTeardownResidueReaper({
    countSurvivingAccountLinks: (record: TeardownResidueRecord) => {
      countedFor.push({
        accountEmail: record.accountEmail,
        provider: record.provider,
      });
      return Promise.resolve(survivingAccountLinks);
    },
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
    revokeOAuthGrant: async (record: TeardownResidueRecord, token: string) => {
      const outcome = await revokeGoogleGrant(token, {
        fetchImpl: endpoint.fetchImpl,
      });

      if (!outcome.revoked) {
        throw new Error(
          `Google refused to revoke the grant behind residue ${record.id} `
            + `(${outcome.status}): ${outcome.body}`,
        );
      }
    },
  } as unknown as Parameters<typeof createTeardownResidueReaper>[0]);

  return { clearedIds, countedFor, endpoint, errors, observed, reap };
};

describe("reaper refuses to revoke a google account a surviving user still holds", () => {
  it("skips the revocation, clears the residue, and reports the skip when another user still holds the account", async () => {
    const harness = createHarness(1);

    const outcome = await harness.reap();

    expect(harness.endpoint.postedTokens).toEqual([]);
    expect(harness.endpoint.isTokenLive(SURVIVING_USER_TOKEN)).toBe(true);
    expect(harness.countedFor).toEqual([
      { accountEmail: SHARED_ACCOUNT, provider: "google" },
    ]);
    expect(harness.clearedIds).toEqual(["residue-oauth-1"]);
    expect(outcome.clearedIds).toContain("residue-oauth-1");
    expect(outcome.failedIds).toEqual([]);
    expect(harness.errors).toEqual([]);
    expect(harness.observed).toEqual([
      expect.objectContaining({
        "teardown_residue.revocation_skipped_count": 1,
      }),
    ]);
  });

  it("still revokes when no surviving user holds the account", async () => {
    const harness = createHarness(0);

    const outcome = await harness.reap();

    expect(harness.endpoint.postedTokens).toEqual([DELETED_USER_TOKEN]);
    expect(harness.endpoint.isTokenLive(SURVIVING_USER_TOKEN)).toBe(false);
    expect(harness.clearedIds).toEqual(["residue-oauth-1"]);
    expect(outcome.failedIds).toEqual([]);
    expect(harness.errors).toEqual([]);
  });
});
