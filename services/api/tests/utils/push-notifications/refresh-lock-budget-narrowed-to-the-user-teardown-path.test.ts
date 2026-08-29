import { beforeEach, describe, expect, it, vi } from "vitest";

const NOW = new Date("2026-08-27T00:00:00.000Z");

const channelRow = {
  accountId: "account-a",
  calendarId: "cal-a",
  createdAt: NOW,
  expiresAt: new Date(NOW.getTime() + 600_000),
  failureCount: 0,
  id: "channel-a",
  lastFailureAt: null,
  lastNotificationAt: null,
  nextAttemptAt: null,
  provider: "google",
  providerChannelId: "google-channel-a",
  providerResourceId: "google-resource-a",
  reauthorizeRequestedAt: null,
  resourcePath: "/calendars/primary/events",
  secretHash: "a".repeat(64),
  state: "active",
  updatedAt: NOW,
  userId: "user-a",
  verifiedAt: NOW,
};

const credentialRow = {
  accessToken: "stale-access-token",
  calendarAccountId: "account-a",
  expiresAt: new Date(Date.now() - 600_000),
  oauthCredentialId: "credential-a",
  refreshToken: "refresh-token-a",
};

const awaitableRows = (rows: unknown[]) =>
  Object.assign(Promise.resolve(rows), { limit: () => Promise.resolve(rows) });

const selectBuilder = (rows: unknown[]) => {
  const builder = {
    from: () => builder,
    innerJoin: () => builder,
    leftJoin: () => builder,
    limit: () => Promise.resolve(rows),
    where: () => awaitableRows(rows),
  };

  return builder;
};

const updateBuilder = () => {
  const builder = {
    set: () => builder,
    where: () => Promise.resolve(undefined),
  };

  return builder;
};

vi.mock("@/utils/logging", () => ({
  context: (run: () => unknown) => run(),
  destroy: () => Promise.resolve(),
  widelog: {
    error: () => null,
    errorFields: () => null,
    set: () => null,
    setFields: () => null,
  },
}));

vi.mock("@/context", () => ({
  database: {
    select: (fields?: unknown) =>
      selectBuilder(fields === undefined ? [channelRow] : [credentialRow]),
    update: () => updateBuilder(),
  },
  env: {
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
  },
  refreshLockStore: {
    release: () => Promise.resolve(),
    tryAcquire: () => Promise.resolve(true),
  },
  webhookConfig: {
    googleCallbackUrl: "https://example.com/api/webhook/google",
    outlookCallbackUrl: "https://example.com/api/webhook/outlook",
  },
}));

const capturedRefresherOptions: { acquireBudgetMs?: number }[] = [];

vi.mock("@keeper.sh/calendar", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createCoordinatedRefresher: (options: { acquireBudgetMs?: number }) => {
    capturedRefresherOptions.push(options);

    return () =>
      Promise.resolve({
        access_token: "fresh-access-token",
        expires_in: 3600,
        refresh_token: "refresh-token-a",
      });
  },
}));

describe("refresh lock acquire budget", () => {
  beforeEach(() => {
    capturedRefresherOptions.length = 0;
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(null, { status: 204 })));
  });

  it("narrows the acquire budget on the user teardown path only", async () => {
    const {
      deregisterAccountPushChannels,
      deregisterUserPushChannels,
    } = await import("@/utils/push-notifications/deregister-account-channels");
    const { PUSH_CHANNELS_TIMEOUT_MS, STEP_ABORT_SETTLE_MS } = await import(
      "@/utils/teardown-step-budgets"
    );

    const accountDeregistered = await deregisterAccountPushChannels("account-a");
    const [accountOptions] = capturedRefresherOptions;

    capturedRefresherOptions.length = 0;

    const { deregisteredCount: userDeregistered } = await deregisterUserPushChannels(
      "user-a",
      null,
    );
    const [userOptions] = capturedRefresherOptions;

    expect({
      accountAcquireBudgetMs: accountOptions?.acquireBudgetMs,
      accountDeregistered,
      userAcquireBudgetMs: userOptions?.acquireBudgetMs,
      userDeregistered,
    }).toEqual({
      accountAcquireBudgetMs: undefined,
      accountDeregistered: 1,
      userAcquireBudgetMs: PUSH_CHANNELS_TIMEOUT_MS - STEP_ABORT_SETTLE_MS,
      userDeregistered: 1,
    });
  });
});
