import { afterEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import { TOKEN_REFRESH_BUFFER_MS } from "@keeper.sh/constants";
import {
  PUSH_CHANNELS_TIMEOUT_MS,
  STEP_ABORT_SETTLE_MS,
} from "../../../src/utils/delete-user-teardown";

const NOW = new Date("2026-08-25T06:15:33.956Z");
const CHANNEL_LIFETIME_MS = 600_000;
const STALE_CREDENTIAL_HEADROOM_MS = Math.floor(TOKEN_REFRESH_BUFFER_MS / 2);
const SETTLE_BUDGET_MS = PUSH_CHANNELS_TIMEOUT_MS + STEP_ABORT_SETTLE_MS;

interface ProxyQuery {
  params: unknown[];
  sql: string;
}

const isoNow = NOW.toISOString();

const channelRow = {
  accountId: "account-a",
  calendarId: "cal-a",
  createdAt: isoNow,
  expiresAt: new Date(NOW.getTime() + CHANNEL_LIFETIME_MS).toISOString(),
  failureCount: 0,
  id: "row-active",
  lastFailureAt: null,
  lastNotificationAt: null,
  nextAttemptAt: null,
  provider: "google",
  providerChannelId: "google-active",
  providerResourceId: "google-resource",
  reauthorizeRequestedAt: null,
  resourcePath: "/calendars/primary/events",
  secretHash: "b".repeat(64),
  state: "active",
  updatedAt: isoNow,
  userId: "user-a",
  verifiedAt: isoNow,
} as const;

const selectedNames = (sql: string): string[] =>
  sql
    .slice("select ".length, sql.indexOf(" from "))
    .split(", ")
    .map((item) => {
      const name = /"([^"]+)"$/u.exec(item);
      if (name === null) {
        throw new Error(`Unparseable select item ${item}`);
      }
      return name[1] as string;
    });

const createProxyDatabase = (queries: ProxyQuery[]) =>
  drizzle((sql, params) => {
    queries.push({ params, sql });

    const staleExpiresAt = new Date(
      Date.now() + STALE_CREDENTIAL_HEADROOM_MS,
    ).toISOString();

    if (sql.includes("\"calendar_push_channels\"")) {
      return Promise.resolve({
        rows: [selectedNames(sql).map((name) =>
          channelRow[name as keyof typeof channelRow])],
      });
    }

    if (sql.includes("\"calendar_accounts\"")) {
      return Promise.resolve({
        rows: [[
          "access-token-a",
          "account-a",
          staleExpiresAt,
          "oauth-credential-a",
          "refresh-token-a",
        ]],
      });
    }

    if (sql.includes("\"oauth_credentials\"")) {
      return Promise.resolve({ rows: [["access-token-a", staleExpiresAt]] });
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

const installContendedLockHarness = async () => {
  const queries: ProxyQuery[] = [];
  const acquireAttempts: string[] = [];

  vi.spyOn(globalThis, "fetch").mockImplementation((() =>
    Promise.reject(
      new Error("the teardown must not reach the provider without a fresh token"),
    )) as unknown as typeof globalThis.fetch);

  vi.doMock("@/context", () => ({
    database: createProxyDatabase(queries),
    env: {
      GOOGLE_CLIENT_ID: "google-client-id",
      GOOGLE_CLIENT_SECRET: "google-client-secret",
    },
    refreshLockStore: {
      release: () => Promise.resolve(),
      tryAcquire: (key: string) => {
        acquireAttempts.push(key);
        return Promise.resolve(false);
      },
    },
    webhookConfig: {
      googleCallbackUrl: "https://example.com/api/webhook/google",
      outlookCallbackUrl: "https://example.com/api/webhook/outlook",
    },
  }));
  vi.resetModules();

  const deregistration = await import(
    "../../../src/utils/push-notifications/deregister-account-channels"
  );

  return { acquireAttempts, deregistration };
};

describe("push channel teardown under a contended refresh lock", () => {
  afterEach(() => {
    vi.doUnmock("@/context");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("gives up on the refresh lock inside the teardown step that granted the budget", async () => {
    const { acquireAttempts, deregistration } = await installContendedLockHarness();

    const startedAt = Date.now();
    const settlement = await deregistration
      .deregisterUserPushChannels("user-a", AbortSignal.timeout(PUSH_CHANNELS_TIMEOUT_MS))
      .then(
        ({ deregisteredCount: deregistered }) => ({ deregistered }),
        (error: unknown) => ({ error }),
      );
    const elapsedMs = Date.now() - startedAt;

    expect(acquireAttempts[0]).toBe("oauth:refresh-lock:oauth-credential-a");
    expect(elapsedMs).toBeLessThan(SETTLE_BUDGET_MS);
    expect(settlement).toEqual({ error: expect.any(AggregateError) });
    expect((settlement as { error: AggregateError }).error.errors.map(
      (error: Error) => error.name,
    )).toEqual(["AbandonedPushChannelError"]);
  });
});
