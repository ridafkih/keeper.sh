import { afterEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";

interface LoggedError {
  error: unknown;
  fields: Record<string, unknown>;
}

const NOW = new Date("2026-08-25T06:15:33.956Z");
const ISO_NOW = NOW.toISOString();
const NO_CONTENT = 204;
const BAD_REQUEST = 400;
const HOUR_MS = 3_600_000;
const TEARDOWN_FAILED_SLUG = "delete-user-teardown-failed";
const PUSH_CHANNELS_PREFIX = "delete_user_teardown.push_channels";
const GOOGLE_INFLIGHT_ROW_ID = "channel-google-registering";
const GOOGLE_INFLIGHT_PROVIDER_CHANNEL_ID = "google-client-channel-inflight";
const OUTLOOK_INFLIGHT_ROW_ID = "channel-outlook-registering";
const ABANDONED_FIELD = "push_channel.disconnect_abandoned";
const ORPHANED_FIELD = "push_channel.disconnect_possibly_orphaned";
const ORPHANED_COUNT_FIELD = "push_channel.disconnect_possibly_orphaned_count";
const DEREGISTERED_COUNT_FIELD = "push_channel.disconnect_deregistered_count";

interface ProxyQuery {
  method: string;
  params: unknown[];
  sql: string;
}

interface ProviderRequest {
  method: string;
  url: string;
}

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

const makeRow = (overrides: Partial<SeededChannelRow>): SeededChannelRow => ({
  accountId: "account-a",
  calendarId: "cal-a",
  createdAt: ISO_NOW,
  expiresAt: new Date(NOW.getTime() + HOUR_MS).toISOString(),
  failureCount: 0,
  id: "row-0",
  lastFailureAt: null,
  lastNotificationAt: null,
  nextAttemptAt: null,
  provider: "google",
  providerChannelId: null,
  providerResourceId: null,
  reauthorizeRequestedAt: null,
  resourcePath: "/calendars/primary/events",
  secretHash: "b".repeat(64),
  state: "registering",
  updatedAt: ISO_NOW,
  userId: "user-a",
  verifiedAt: null,
  ...overrides,
});

const seedRows = (): SeededChannelRow[] => [
  makeRow({
    id: GOOGLE_INFLIGHT_ROW_ID,
    provider: "google",
    providerChannelId: GOOGLE_INFLIGHT_PROVIDER_CHANNEL_ID,
    providerResourceId: null,
    state: "registering",
  }),
  makeRow({
    id: OUTLOOK_INFLIGHT_ROW_ID,
    provider: "outlook",
    providerChannelId: null,
    providerResourceId: null,
    state: "registering",
  }),
];

const seedCredentialsRow = (): unknown[] => [
  "access-token-a",
  "account-a",
  new Date(NOW.getTime() + HOUR_MS).toISOString(),
  "oauth-credential-a",
  "refresh-token-a",
];

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

const matchingRows = (
  sql: string,
  params: unknown[],
  rows: SeededChannelRow[],
): SeededChannelRow[] => {
  const scope = /"calendar_push_channels"\."(\w+)" = \$(\d+)/u.exec(sql);

  if (scope === null) {
    throw new Error(`Unexpected push channel query shape: ${sql}`);
  }

  const scopeColumn = scope[1] as keyof SeededChannelRow;
  const scopeValue = params[Number(scope[2]) - 1];

  return rows.filter((row) => row[scopeColumn] === scopeValue);
};

const createProxyDatabase = (queries: ProxyQuery[], rows: SeededChannelRow[]) =>
  drizzle((sql, params, method) => {
    queries.push({ method, params, sql });

    if (sql.startsWith("update ")) {
      return Promise.resolve({ rows: [] });
    }

    if (sql.includes("\"calendar_push_channels\"")) {
      const names = selectedNames(sql);
      return Promise.resolve({
        rows: matchingRows(sql, params, rows).map((row) =>
          names.map((name) => row[name as keyof SeededChannelRow])),
      });
    }

    if (sql.includes("\"oauth_credentials\"")) {
      return Promise.resolve({ rows: [seedCredentialsRow()] });
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

const createProviderFetchStub = (
  liveWatches: Set<string>,
  providerRequests: ProviderRequest[],
) =>
  vi.fn((url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    const method = init?.method ?? "GET";
    providerRequests.push({ method, url: href });

    if (href.endsWith("channels/stop")) {
      const { id, resourceId } = JSON.parse(String(init?.body)) as {
        id: string;
        resourceId: string;
      };
      if (!resourceId) {
        return Promise.resolve(new Response(null, { status: BAD_REQUEST }));
      }
      liveWatches.delete(id);
      return Promise.resolve(new Response(null, { status: NO_CONTENT }));
    }

    if (href.includes("/subscriptions/") && method === "DELETE") {
      liveWatches.delete(href.slice(href.lastIndexOf("/") + 1));
      return Promise.resolve(new Response(null, { status: NO_CONTENT }));
    }

    throw new Error(`Unexpected provider request ${method} ${href}`);
  });

const describeError = (error: unknown): string => {
  if (!(error instanceof Error)) {
    return String(error);
  }

  if (error instanceof AggregateError) {
    const causes = error.errors.map((inner) => describeError(inner)).join(" ");
    return `${error.message} ${String(error.cause ?? "")} ${causes}`;
  }

  return `${error.message} ${String(error.cause ?? "")}`;
};

const settle = async <Value>(work: Promise<Value>) =>
  await work.then(
    (value) => ({ status: "fulfilled" as const, value }),
    (error: unknown) => ({ error, status: "rejected" as const }),
  );

const createHarness = async () => {
  const liveWatches = new Set([GOOGLE_INFLIGHT_PROVIDER_CHANNEL_ID]);
  const providerRequests: ProviderRequest[] = [];
  const proxyQueries: ProxyQuery[] = [];
  const loggedErrors: LoggedError[] = [];
  const loggedFields: Record<string, unknown>[] = [];

  vi.spyOn(globalThis, "fetch").mockImplementation(
    createProviderFetchStub(liveWatches, providerRequests) as unknown as
      typeof globalThis.fetch,
  );

  vi.resetModules();

  vi.doMock("@/utils/logging", () => ({
    context: (run: () => unknown) => run(),
    destroy: () => Promise.resolve(),
    widelog: {
      error: (prefix: string, error: unknown) => {
        loggedErrors.push({ error, fields: { prefix } });
      },
      errorFields: (error: unknown, fields: Record<string, unknown>) => {
        loggedErrors.push({ error, fields });
      },
      set: (key: string, value: unknown) => {
        loggedFields.push({ [key]: value });
      },
      setFields: (fields: Record<string, unknown>) => {
        loggedFields.push(fields);
      },
    },
  }));

  vi.doMock("@/context", () => ({
    database: createProxyDatabase(proxyQueries, seedRows()),
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
  }));

  const channels = await import("@/utils/push-notifications/deregister-account-channels");

  const observedField = (field: string): unknown => {
    const entry = loggedFields.findLast((fields) => field in fields);
    return entry?.[field];
  };

  const removedStateUpdates = (): ProxyQuery[] =>
    proxyQueries.filter((query) =>
      query.sql.startsWith("update ")
      && query.sql.includes("\"calendar_push_channels\"")
      && query.params.includes("removed"));

  return {
    channels,
    liveWatches,
    loggedErrors,
    observedField,
    providerRequests,
    removedStateUpdates,
  };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock("@/context");
  vi.doUnmock("@/utils/logging");
  vi.resetModules();
});

describe("a registering push channel is never silently reported stopped", () => {
  it("abandons the google row whose client-assigned id may already be live at the provider", async () => {
    const harness = await createHarness();

    const outcome = await settle(
      harness.channels.deregisterUserPushChannels("user-a"),
    );

    expect(harness.observedField(DEREGISTERED_COUNT_FIELD)).toBe(0);

    expect(harness.removedStateUpdates()).toEqual([]);

    const namedErrors = harness.loggedErrors.filter((entry) =>
      entry.fields.slug === harness.channels.DEREGISTRATION_FAILED_SLUG
      && describeError(entry.error).includes(GOOGLE_INFLIGHT_PROVIDER_CHANNEL_ID));

    expect(namedErrors.length).toBeGreaterThan(0);

    expect(JSON.stringify(harness.observedField(ABANDONED_FIELD)))
      .toContain(GOOGLE_INFLIGHT_PROVIDER_CHANNEL_ID);

    expect(harness.liveWatches.has(GOOGLE_INFLIGHT_PROVIDER_CHANNEL_ID)).toBe(true);

    expect(outcome.status).toBe("rejected");
  });

  it("surfaces the outlook row with no provider id as a distinct possibly-orphaned signal", async () => {
    const harness = await createHarness();

    await settle(harness.channels.deregisterUserPushChannels("user-a"));

    expect(harness.observedField(ORPHANED_COUNT_FIELD)).toBe(1);

    const orphaned = JSON.stringify(harness.observedField(ORPHANED_FIELD));
    expect(orphaned).toContain(OUTLOOK_INFLIGHT_ROW_ID);
    expect(orphaned).not.toContain(GOOGLE_INFLIGHT_PROVIDER_CHANNEL_ID);

    expect(JSON.stringify(harness.observedField(ABANDONED_FIELD)))
      .not.toContain(OUTLOOK_INFLIGHT_ROW_ID);
  });

  it("does not throw for the account scope, where in-flight rows are routine", async () => {
    const harness = await createHarness();

    const outcome = await settle(
      harness.channels.deregisterAccountPushChannels("account-a"),
    );

    expect(outcome.status).toBe("fulfilled");
    expect(harness.removedStateUpdates()).toEqual([]);
  });

  it("still lets delete-user succeed, reporting the abandonment on the wide event", async () => {
    const harness = await createHarness();
    const { createDeleteUserSyncTeardown } = await import("@/utils/delete-user-teardown");

    const teardown = createDeleteUserSyncTeardown({
      createQueue: () => ({
        getJob: () => Promise.resolve({}),
        remove: () => Promise.resolve(0),
      }),
      deregisterPushChannels: async (userId: string, signal: AbortSignal) =>
        await harness.channels.deregisterUserPushChannels(userId, signal),
      listCalendarIds: () => Promise.resolve([]),
      listOAuthCredentials: () => Promise.resolve([]),
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

    const teardownErrors = harness.loggedErrors.filter((entry) =>
      entry.fields.slug === TEARDOWN_FAILED_SLUG
      && entry.fields.prefix === PUSH_CHANNELS_PREFIX
      && describeError(entry.error).includes(GOOGLE_INFLIGHT_PROVIDER_CHANNEL_ID));

    expect(teardownErrors.length).toBeGreaterThan(0);
  });
});
