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
const OBSERVATION_WINDOW_MS = SETTLE_BUDGET_MS + 3000;
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const REFRESH_LOCK_KEY = "oauth:refresh-lock:oauth-credential-a";

interface ProxyQuery {
  params: unknown[];
  sql: string;
}

interface TokenDial {
  aborted: boolean;
  url: string;
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

const installFreeLockHarness = async () => {
  const queries: ProxyQuery[] = [];
  const acquireAttempts: string[] = [];
  const releases: string[] = [];
  const dials: TokenDial[] = [];

  vi.spyOn(globalThis, "fetch").mockImplementation(((
    input: unknown,
    init?: { signal?: AbortSignal | null },
  ) => {
    const dial: TokenDial = { aborted: false, url: String(input) };
    dials.push(dial);

    return new Promise((_resolve, reject) => {
      const signal = init?.signal ?? null;
      if (signal === null) {
        return;
      }

      const abandon = (): void => {
        dial.aborted = true;
        reject(signal.reason);
      };

      if (signal.aborted) {
        abandon();
        return;
      }

      signal.addEventListener("abort", abandon, { once: true });
    });
  }) as unknown as typeof globalThis.fetch);

  vi.doMock("@/context", () => ({
    database: createProxyDatabase(queries),
    env: {
      GOOGLE_CLIENT_ID: "google-client-id",
      GOOGLE_CLIENT_SECRET: "google-client-secret",
    },
    refreshLockStore: {
      release: (key: string) => {
        releases.push(key);
        return Promise.resolve();
      },
      tryAcquire: (key: string) => {
        acquireAttempts.push(key);
        return Promise.resolve(true);
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

  return { acquireAttempts, deregistration, dials, releases };
};

describe("push channel teardown holding an uncontended refresh lock", () => {
  afterEach(() => {
    vi.doUnmock("@/context");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("aborts the in-flight token refresh when the teardown step's signal fires", async () => {
    const { acquireAttempts, deregistration, dials, releases } =
      await installFreeLockHarness();

    const startedAt = Date.now();
    const settlement = await Promise.race([
      deregistration
        .deregisterUserPushChannels(
          "user-a",
          AbortSignal.timeout(PUSH_CHANNELS_TIMEOUT_MS),
        )
        .then(
          ({ deregisteredCount: deregistered }) => ({ deregistered }),
          (error: unknown) => ({ error }),
        ),
      new Promise((resolve) => {
        setTimeout(() => resolve("still-running"), OBSERVATION_WINDOW_MS);
      }),
    ]);
    const elapsedMs = Date.now() - startedAt;

    expect(acquireAttempts).toEqual([REFRESH_LOCK_KEY]);
    expect(settlement).not.toBe("still-running");
    expect(elapsedMs).toBeLessThan(SETTLE_BUDGET_MS);

    const tokenDials = dials.filter((dial) => dial.url === GOOGLE_TOKEN_URL);
    expect(tokenDials.length).toBeGreaterThan(0);
    expect(tokenDials.map((dial) => dial.aborted)).toEqual(
      tokenDials.map(() => true),
    );
    expect(releases).toEqual([REFRESH_LOCK_KEY]);
  });
});
