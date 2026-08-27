import { describe, expect, it } from "vitest";
import { createTeardownResidueReaper, OAUTH_GRANT_RESIDUE_KIND } from "@keeper.sh/calendar";
import type {
  RegistrarContext,
  TeardownResidueRecord,
  TeardownResidueStore,
} from "@keeper.sh/calendar";
import { revokeOAuthGrant } from "../../src/jobs/reap-teardown-residue";

const NOW = new Date("2026-08-26T12:00:00.000Z");
const FUTURE = new Date("2026-09-30T12:00:00.000Z");
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const ALREADY_REVOKED_BODY = JSON.stringify({ error: "invalid_token" });
const GOOGLE_SERVER_ERROR_BODY = `<!DOCTYPE html>
<html lang=en>
  <meta charset=utf-8>
  <meta name=viewport content="initial-scale=1, minimum-scale=1, width=device-width">
  <title>Error 500 (Server Error)!!1</title>
  <p><b>500.</b> <ins>That's an error.</ins>
  <p>There was an error. Please try again later.  <ins>That's all we know.</ins>
`;

const oauthGrantResidue = (
  overrides: Partial<TeardownResidueRecord> = {},
): TeardownResidueRecord => ({
  accountEmail: "owner@example.com",
  createdAt: new Date("2026-08-25T06:15:33.956Z"),
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

const respondWith = (response: () => Response) => {
  const postedTokens: string[] = [];

  const fetchImpl = (input: string, init: RequestInit): Promise<Response> => {
    expect(input).toBe(GOOGLE_REVOKE_URL);
    postedTokens.push(new URLSearchParams(String(init.body)).get("token") ?? "");
    return Promise.resolve(response());
  };

  return { fetchImpl, postedTokens };
};

const registrarContext = (): RegistrarContext => ({
  accessToken: "access-token-value",
  channelId: null,
  fetchImpl: globalThis.fetch,
  notificationUrl: "https://keeper.sh/webhooks/google",
  now: NOW,
  requestedExpiresAt: FUTURE,
});

const createReaper = (
  records: TeardownResidueRecord[],
  fetchImpl: (input: string, init: RequestInit) => Promise<Response>,
) => {
  const clearedIds: string[] = [];
  const errors: { error: unknown; slug: string }[] = [];
  const store: TeardownResidueStore = {
    clear: (residueId: string) => {
      clearedIds.push(residueId);
      return Promise.resolve();
    },
    deleteForUser: () => Promise.resolve(0),
    list: () => Promise.resolve(records),
    purgeOrphaned: () => Promise.resolve([]),
    record: () => Promise.resolve(),
  };

  const reap = createTeardownResidueReaper({
    countSurvivingAccountLinks: () =>
      Promise.resolve({ coHolders: 0, identityResolved: true }),
    createRegistrarContext: () => Promise.resolve(registrarContext()),
    deletePolarCustomer: () => Promise.reject(new Error("polar is not part of this test")),
    now: () => NOW,
    observe: () => undefined,
    recordError: (error: unknown, slug: string) => {
      errors.push({ error, slug });
    },
    residue: store,
    resolveRegistrar: () => null,
    revokeOAuthGrant: (record: TeardownResidueRecord, token: string) =>
      revokeOAuthGrant(record, token, { fetchImpl }),
  } as unknown as Parameters<typeof createTeardownResidueReaper>[0]);

  return { clearedIds, errors, reap };
};

describe("an already revoked grant stops being retried for eight days", () => {
  it("treats Google's invalid_token refusal as the grant already not being in force", async () => {
    const { fetchImpl, postedTokens } = respondWith(
      () => new Response(ALREADY_REVOKED_BODY, { status: 400 }),
    );

    await expect(
      revokeOAuthGrant(oauthGrantResidue(), "refresh-token-value", { fetchImpl }),
    ).resolves.toBeUndefined();

    expect(postedTokens).toEqual(["refresh-token-value"]);
  });

  it("still throws when Google itself is broken", async () => {
    const { fetchImpl } = respondWith(
      () => new Response(GOOGLE_SERVER_ERROR_BODY, { status: 500 }),
    );

    await expect(
      revokeOAuthGrant(oauthGrantResidue(), "refresh-token-value", { fetchImpl }),
    ).rejects.toThrow(/500/);
  });

  it("clears the residue on the pass that meets invalid_token", async () => {
    const { fetchImpl } = respondWith(
      () => new Response(ALREADY_REVOKED_BODY, { status: 400 }),
    );
    const harness = createReaper([oauthGrantResidue()], fetchImpl);

    const outcome = await harness.reap();

    expect(harness.errors).toEqual([]);
    expect(outcome.clearedIds).toEqual(["residue-oauth"]);
    expect(harness.clearedIds).toEqual(["residue-oauth"]);
  });
});
