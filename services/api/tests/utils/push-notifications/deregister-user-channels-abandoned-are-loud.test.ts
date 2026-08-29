import { afterEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import {
  DEREGISTRATION_FAILED_SLUG,
  deregisterUserPushChannels,
} from "@/utils/push-notifications/deregister-account-channels";

interface LoggedError {
  error: unknown;
  fields: Record<string, unknown>;
}

vi.mock("@/utils/logging", () => ({
  context: (run: () => unknown) => run(),
  destroy: () => Promise.resolve(),
  widelog: {
    error: vi.fn(),
    errorFields: vi.fn(),
    set: vi.fn(),
    setFields: vi.fn(),
  },
}));

const SERVER_ERROR = 503;
const NO_CONTENT = 204;
const TEARDOWN_FAILED_SLUG = "delete-user-teardown-failed";
const PUSH_CHANNELS_PREFIX = "delete_user_teardown.push_channels";
const STOPPABLE_PROVIDER_CHANNEL_ID = "google-channel-stoppable";
const ABANDONED_CHANNEL_ID = "channel-abandoned";
const ABANDONED_PROVIDER_CHANNEL_ID = "google-channel-abandoned";

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

vi.mock("@/context", () => {
  interface SeededChannelRow {
    accountId: string;
    calendarId: string | null;
    createdAt: string;
    expiresAt: string | null;
    failureCount: number;
    id: string;
    lastFailureAt: string | null;
    lastNotificationAt: string | null;
    nextAttemptAt: string | null;
    provider: string;
    providerChannelId: string | null;
    providerResourceId: string | null;
    reauthorizeRequestedAt: string | null;
    resourcePath: string | null;
    secretHash: string;
    state: string;
    updatedAt: string;
    userId: string;
    verifiedAt: string | null;
  }

  const now = new Date("2026-08-25T06:15:33.956Z");
  const isoNow = now.toISOString();
  const hourMs = 3_600_000;
  const isoHourFromNow = new Date(now.getTime() + hourMs).toISOString();

  const makeRow = (overrides: Partial<SeededChannelRow>): SeededChannelRow => ({
    accountId: "account-a",
    calendarId: "cal-a",
    createdAt: isoNow,
    expiresAt: isoHourFromNow,
    failureCount: 0,
    id: "row-0",
    lastFailureAt: null,
    lastNotificationAt: null,
    nextAttemptAt: null,
    provider: "google",
    providerChannelId: null,
    providerResourceId: "google-resource",
    reauthorizeRequestedAt: null,
    resourcePath: "/calendars/primary/events",
    secretHash: "b".repeat(64),
    state: "active",
    updatedAt: isoNow,
    userId: "user-a",
    verifiedAt: isoNow,
    ...overrides,
  });

  const seededRows: SeededChannelRow[] = [
    makeRow({
      id: "channel-stoppable",
      providerChannelId: STOPPABLE_PROVIDER_CHANNEL_ID,
      providerResourceId: "google-resource-stoppable",
    }),
    makeRow({
      accountId: "account-b",
      calendarId: "cal-b",
      id: ABANDONED_CHANNEL_ID,
      providerChannelId: ABANDONED_PROVIDER_CHANNEL_ID,
      providerResourceId: "google-resource-abandoned",
    }),
  ];

  const credentialsRow = [
    "access-token-a",
    "account-a",
    isoHourFromNow,
    "oauth-credential-a",
    "refresh-token-a",
  ];

  const matchingRows = (sql: string, params: unknown[]): SeededChannelRow[] => {
    const scope = /"calendar_push_channels"\."(\w+)" = \$(\d+)/u.exec(sql);

    if (scope === null) {
      throw new Error(`Unexpected push channel query shape: ${sql}`);
    }

    const scopeColumn = scope[1] as keyof SeededChannelRow;
    const scopeValue = params[Number(scope[2]) - 1];

    return seededRows.filter((row) => row[scopeColumn] === scopeValue);
  };

  const database = drizzle((sql, params) => {
    if (sql.startsWith("update ")) {
      return Promise.resolve({ rows: [] });
    }

    if (sql.includes("\"calendar_push_channels\"")) {
      const names = selectedNames(sql);
      return Promise.resolve({
        rows: matchingRows(sql, params).map((row) =>
          names.map((name) => row[name as keyof SeededChannelRow])),
      });
    }

    if (sql.includes("\"oauth_credentials\"")) {
      return Promise.resolve({ rows: [credentialsRow] });
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  return {
    database,
    env: {},
    refreshLockStore: {
      release: () => Promise.resolve(),
      tryAcquire: () => Promise.resolve(true),
    },
    redis: {
      del: () => Promise.resolve(1),
      exists: () => Promise.resolve(1),
      set: () => Promise.resolve("OK"),
    },
    webhookConfig: {
      googleCallbackUrl: "https://example.com/api/webhook/google",
      outlookCallbackUrl: "https://example.com/api/webhook/outlook",
    },
  };
});

const stubStopFetch = () => {
  const stopRequests: string[] = [];

  const fetchStub = vi.fn((_url: string, init?: RequestInit) => {
    const { id } = JSON.parse(String(init?.body)) as { id: string };
    stopRequests.push(id);

    if (id === ABANDONED_PROVIDER_CHANNEL_ID) {
      return Promise.resolve(new Response(null, { status: SERVER_ERROR }));
    }
    return Promise.resolve(new Response(null, { status: NO_CONTENT }));
  });

  vi.spyOn(globalThis, "fetch").mockImplementation(
    fetchStub as unknown as typeof globalThis.fetch,
  );

  return stopRequests;
};

const captureLoggedErrors = async (): Promise<LoggedError[]> => {
  const { widelog } = await import("@/utils/logging");
  const loggedErrors: LoggedError[] = [];

  vi.spyOn(widelog, "error").mockImplementation((prefix, error) => {
    loggedErrors.push({ error, fields: { prefix } });
  });
  vi.spyOn(widelog, "errorFields").mockImplementation((error, options) => {
    loggedErrors.push({ error, fields: { ...options } });
  });

  return loggedErrors;
};

const describeError = (error: unknown): string => {
  if (error instanceof Error) {
    return `${error.message} ${String(error.cause ?? "")}`;
  }
  return String(error);
};

const settle = async <Value>(work: Promise<Value>) =>
  await work.then(
    (value) => ({ status: "fulfilled" as const, value }),
    (error: unknown) => ({ error, status: "rejected" as const }),
  );

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a push channel the provider refused to stop is a loud failure", () => {
  it("names the abandoned channel in a recorded error and fails to its caller", async () => {
    const loggedErrors = await captureLoggedErrors();
    const stopRequests = stubStopFetch();

    const outcome = await settle(deregisterUserPushChannels("user-a"));

    expect(stopRequests.toSorted())
      .toEqual([ABANDONED_PROVIDER_CHANNEL_ID, STOPPABLE_PROVIDER_CHANNEL_ID]);

    const namedErrors = loggedErrors.filter((entry) =>
      entry.fields.slug === DEREGISTRATION_FAILED_SLUG
      && describeError(entry.error).includes(ABANDONED_CHANNEL_ID)
      && describeError(entry.error).includes(ABANDONED_PROVIDER_CHANNEL_ID));

    expect(namedErrors.length).toBeGreaterThan(0);

    expect(outcome.status).toBe("rejected");
  });

  it("reports the abandonment through the delete-user teardown wide event without blocking the delete", async () => {
    const loggedErrors = await captureLoggedErrors();
    stubStopFetch();

    const { createDeleteUserSyncTeardown } = await import("@/utils/delete-user-teardown");

    const teardown = createDeleteUserSyncTeardown({
      createQueue: () => ({
        getJob: () => Promise.resolve({}),
        remove: () => Promise.resolve(0),
      }),
      deregisterPushChannels: async (userId: string, signal: AbortSignal) =>
        await deregisterUserPushChannels(userId, signal),
      listCalendarIds: () => Promise.resolve([]),
      listOAuthGrantProviders: () => Promise.resolve([]),
      listPushChannels: () => Promise.resolve([]),
      redis: {
        del: () => Promise.resolve(1),
        exists: () => Promise.resolve(1),
        set: () => Promise.resolve("OK"),
      },
      residue: {
        clear: () => Promise.resolve(),
        deleteForUser: () => Promise.resolve(0),
        list: () => Promise.resolve([]),
        purgeOrphaned: () => Promise.resolve([]),
        record: () => Promise.resolve(),
        spendRepairAttempt: () =>
          Promise.reject(new Error("the teardown never spends a repair attempt")),
      },
    });

    await expect(teardown("user-a")).resolves.toBeUndefined();

    const teardownErrors = loggedErrors.filter((entry) =>
      entry.fields.slug === TEARDOWN_FAILED_SLUG
      && entry.fields.prefix === PUSH_CHANNELS_PREFIX);

    expect(teardownErrors.length).toBeGreaterThan(0);
  });
});
