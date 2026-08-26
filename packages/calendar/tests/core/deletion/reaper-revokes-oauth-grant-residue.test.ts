import { describe, expect, it } from "vitest";
import {
  createTeardownResidueReaper,
  RESIDUE_REPAIR_FAILED_SLUG,
} from "../../../src/core/deletion/teardown-residue-reaper";
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
const LONG_PAST = new Date("2026-04-01T12:00:00.000Z");
const NO_ATTEMPTS_YET = 0;

const oauthGrantRecord = (
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
  externalId: "account-1",
  id: "residue-1",
  kind: OAUTH_GRANT_RESIDUE_KIND,
  provider: "google",
  providerAccountId: "1099876543210",
  userId: "user-1",
  ...overrides,
});

const pushChannelRecord = (
  overrides: Partial<TeardownResidueRecord> = {},
): TeardownResidueRecord => ({
  createdAt: new Date("2026-08-25T06:15:33.956Z"),
  expiresAt: FUTURE,
  id: "residue-push-1",
  kind: PUSH_CHANNEL_RESIDUE_KIND,
  provider: "google",
  providerChannelId: "channel-1",
  providerResourceId: "resource-1",
  userId: "user-1",
  ...overrides,
});

const createStore = (records: TeardownResidueRecord[]) => {
  const clearedIds: string[] = [];
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

  return { clearedIds, store };
};

const createRevoker = (
  respond: (token: string) => Response,
) => {
  const postedTokens: string[] = [];

  const fetchImpl = (input: string, init: RequestInit): Promise<Response> => {
    expect(input).toBe(GOOGLE_REVOKE_URL);
    const token = new URLSearchParams(String(init.body)).get("token") ?? "";
    postedTokens.push(token);
    return Promise.resolve(respond(token));
  };

  const revokeOAuthGrant = async (
    record: TeardownResidueRecord,
    token: string,
  ): Promise<void> => {
    expect(record.kind).toBe(OAUTH_GRANT_RESIDUE_KIND);
    const outcome = await revokeGoogleGrant(token, { fetchImpl });

    if (!outcome.revoked) {
      throw new Error(
        `Google refused to revoke the grant behind residue ${record.id} `
          + `(${outcome.status}): ${outcome.body}`,
      );
    }
  };

  return { postedTokens, revokeOAuthGrant };
};

const createRegistrar = (deregisterFails = false) => {
  const deregistered: StoredPushChannel[] = [];
  const registrar = {
    deregister: (channel: StoredPushChannel) => {
      deregistered.push(channel);

      if (deregisterFails) {
        return Promise.reject(
          new Error("Google refused to stop the channel (500): backend error"),
        );
      }

      return Promise.resolve();
    },
    maxLifetimeMs: 604_800_000,
    provider: "google",
    register: () => Promise.reject(new Error("register is not part of this test")),
    renew: () => Promise.reject(new Error("renew is not part of this test")),
    renewalMode: "renew",
    resolveAffectedCalendarIds: () => Promise.resolve([]),
    scopeKind: "account",
  } as unknown as SourcePushRegistrar;

  return { deregistered, registrar };
};

const registrarContext = (): RegistrarContext => ({
  accessToken: "access-token-value",
  channelId: null,
  fetchImpl: globalThis.fetch,
  notificationUrl: "https://keeper.sh/webhooks/google",
  now: NOW,
  requestedExpiresAt: FUTURE,
});

const createReaper = (options: {
  deregisterFails?: boolean;
  records: TeardownResidueRecord[];
  respond: (token: string) => Response;
}) => {
  const { clearedIds, store } = createStore(options.records);
  const { postedTokens, revokeOAuthGrant } = createRevoker(options.respond);
  const { deregistered, registrar } = createRegistrar(options.deregisterFails ?? false);
  const errors: { error: unknown; slug: string }[] = [];

  const reap = createTeardownResidueReaper({
    countSurvivingAccountLinks: () => Promise.resolve(0),
    createRegistrarContext: () => Promise.resolve(registrarContext()),
    deletePolarCustomer: () => Promise.reject(new Error("polar is not part of this test")),
    now: () => NOW,
    observe: () => undefined,
    recordError: (error: unknown, slug: string) => {
      errors.push({ error, slug });
    },
    residue: store,
    resolveRegistrar: (provider: string) => (provider === "google" ? registrar : null),
    revokeOAuthGrant,
  } as unknown as Parameters<typeof createTeardownResidueReaper>[0]);

  return { clearedIds, deregistered, errors, postedTokens, reap };
};

const ok = () => new Response("", { status: 200 });
const unavailable = () => new Response("backend error", { status: 503 });

describe("teardown residue reaper oauth grant revocation", () => {
  it("revokes the grant with the refresh token and clears the row", async () => {
    const harness = createReaper({ records: [oauthGrantRecord()], respond: ok });

    const outcome = await harness.reap();

    expect(harness.postedTokens).toEqual(["refresh-token-value"]);
    expect(outcome.clearedIds).toContain("residue-1");
    expect(harness.clearedIds).toContain("residue-1");
    expect(outcome.failedIds).toEqual([]);
    expect(harness.errors).toEqual([]);
  });

  it("keeps the row and reports loudly when the revoke endpoint answers 503", async () => {
    const harness = createReaper({
      records: [oauthGrantRecord()],
      respond: unavailable,
    });

    const outcome = await harness.reap();

    expect(harness.postedTokens).toEqual(["refresh-token-value"]);
    expect(outcome.failedIds).toEqual(["residue-1"]);
    expect(outcome.clearedIds).toEqual([]);
    expect(harness.clearedIds).toEqual([]);
    expect(harness.errors.map((entry) => entry.slug)).toEqual([
      RESIDUE_REPAIR_FAILED_SLUG,
    ]);
  });

  it("holds the grant back while a push channel residue for the same user and provider is outstanding", async () => {
    const held = createReaper({
      records: [oauthGrantRecord(), pushChannelRecord()],
      respond: ok,
    });

    const first = await held.reap();

    expect(held.deregistered.map((channel) => channel.providerChannelId)).toEqual([
      "channel-1",
    ]);
    expect(first.clearedIds).toEqual(["residue-push-1"]);
    expect(first.failedIds).toEqual([]);
    expect(first.expiredIds).toEqual([]);
    expect(held.postedTokens).toEqual([]);
    expect(held.errors).toEqual([]);

    const released = createReaper({ records: [oauthGrantRecord()], respond: ok });

    const second = await released.reap();

    expect(released.postedTokens).toEqual(["refresh-token-value"]);
    expect(second.clearedIds).toEqual(["residue-1"]);
    expect(released.errors.map((entry) => entry.slug)).not.toContain(
      RESIDUE_REPAIR_FAILED_SLUG,
    );
  });

  it("never clears or expires a token bearing row past its expiry without a completed revocation", async () => {
    const harness = createReaper({
      records: [oauthGrantRecord({ expiresAt: LONG_PAST })],
      respond: unavailable,
    });

    const outcome = await harness.reap();

    expect(harness.postedTokens).toEqual(["refresh-token-value"]);
    expect(outcome.clearedIds).toEqual([]);
    expect(outcome.expiredIds).toEqual([]);
    expect(harness.clearedIds).toEqual([]);
    expect(outcome.failedIds).toEqual(["residue-1"]);
  });
});

describe("teardown residue reaper deferral bound behind a failing push repair", () => {
  const ATTEMPTS_BEYOND_ANY_BOUND = 12;

  it("revokes the grant once the blocking push channel repair has failed a bounded number of times", async () => {
    const harness = createReaper({
      deregisterFails: true,
      records: [
        oauthGrantRecord(),
        pushChannelRecord({ attempts: ATTEMPTS_BEYOND_ANY_BOUND }),
      ],
      respond: ok,
    });

    const outcome = await harness.reap();

    expect(harness.deregistered.map((channel) => channel.providerChannelId)).toEqual([
      "channel-1",
    ]);
    expect(harness.postedTokens).toEqual(["refresh-token-value"]);
    expect(outcome.clearedIds).toContain("residue-1");
    expect(harness.clearedIds).toContain("residue-1");
    expect(outcome.clearedIds).not.toContain("residue-push-1");
    expect(outcome.failedIds).toEqual(["residue-push-1"]);
  });

  it("still defers the grant while the blocking push channel repair has attempts left", async () => {
    const harness = createReaper({
      deregisterFails: true,
      records: [oauthGrantRecord(), pushChannelRecord({ attempts: NO_ATTEMPTS_YET })],
      respond: ok,
    });

    const outcome = await harness.reap();

    expect(harness.postedTokens).toEqual([]);
    expect(outcome.clearedIds).toEqual([]);
    expect(harness.clearedIds).toEqual([]);
    expect(outcome.failedIds).toEqual(["residue-push-1"]);
  });
});
