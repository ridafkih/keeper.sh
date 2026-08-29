import { afterEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import type { StoredPushChannel } from "@keeper.sh/calendar";
import {
  DEREGISTRATION_FAILED_SLUG,
  deregisterUserPushChannels,
  runDeregisterUserPushChannels,
} from "../../../src/utils/push-notifications/deregister-account-channels";

const NOW = new Date("2026-08-25T06:15:33.956Z");

const makeChannel = (overrides: Partial<StoredPushChannel> = {}): StoredPushChannel => ({
  accountId: "account-1",
  calendarId: "cal-1",
  createdAt: NOW,
  expiresAt: new Date(NOW.getTime() + 60_000),
  failureCount: 0,
  id: "channel-1",
  lastFailureAt: null,
  lastNotificationAt: null,
  nextAttemptAt: null,
  provider: "google",
  providerChannelId: "google-channel-1",
  providerResourceId: "google-resource-1",
  reauthorizeRequestedAt: null,
  resourcePath: "/calendars/primary/events",
  secretHash: "a".repeat(64),
  state: "active",
  updatedAt: NOW,
  userId: "user-1",
  verifiedAt: NOW,
  ...overrides,
});

type DeregisterMock = (channel: StoredPushChannel) => Promise<void>;

const makeRegistrar = (provider: string, deregister: DeregisterMock) => ({
  deregister,
  maxLifetimeMs: 604_800_000,
  provider,
  register: vi.fn(),
  renew: vi.fn(),
  renewalMode: "recreate" as const,
  resolveAffectedCalendarIds: vi.fn(),
  scopeKind: "calendar" as const,
  supportsList: false,
});

const makeDependencies = (overrides: Record<string, unknown> = {}) => ({
  createRegistrarContext: vi.fn((channel: StoredPushChannel) => Promise.resolve({
    accessToken: "token",
    channelId: channel.providerChannelId,
    fetchImpl: globalThis.fetch,
    notificationUrl: "https://example.com/api/webhook/google",
    now: NOW,
    requestedExpiresAt: NOW,
  })),
  listLiveChannels: vi.fn(() => Promise.resolve([makeChannel()])),
  observe: vi.fn(),
  recordError: vi.fn(),
  resolveRegistrar: vi.fn((provider: string) =>
    makeRegistrar(provider, vi.fn<DeregisterMock>(() => Promise.resolve()))),
  webhookConfigured: true,
  ...overrides,
});

const resolveUserRunner = () => {
  expect(runDeregisterUserPushChannels).toBeTypeOf("function");

  return runDeregisterUserPushChannels as unknown as (
    userId: string,
    dependencies: ReturnType<typeof makeDependencies>,
  ) => Promise<number>;
};

describe("push channel teardown for a deleted user", () => {
  it("exposes a user scoped deregistration entry point for delete teardown", () => {
    expect(deregisterUserPushChannels).toBeTypeOf("function");
  });

  it("deregisters every live channel the user owns across providers", async () => {
    const deregisterGoogle = vi.fn<DeregisterMock>(() => Promise.resolve());
    const deregisterOutlook = vi.fn<DeregisterMock>(() => Promise.resolve());
    const dependencies = makeDependencies({
      listLiveChannels: vi.fn(() => Promise.resolve([
        makeChannel({ id: "channel-1", providerChannelId: "google-channel-1" }),
        makeChannel({
          accountId: "account-2",
          calendarId: "cal-2",
          id: "channel-2",
          provider: "outlook",
          providerChannelId: "graph-subscription-1",
        }),
      ])),
      resolveRegistrar: vi.fn((provider: string) =>
        makeRegistrar(provider, { google: deregisterGoogle, outlook: deregisterOutlook }[provider] ?? deregisterOutlook)),
    });

    await expect(resolveUserRunner()("user-1", dependencies)).resolves.toBe(2);

    expect(dependencies.listLiveChannels).toHaveBeenCalledWith("user-1");
    expect(deregisterGoogle.mock.calls.map(([channel]) => channel.providerChannelId))
      .toEqual(["google-channel-1"]);
    expect(deregisterOutlook.mock.calls.map(([channel]) => channel.providerChannelId))
      .toEqual(["graph-subscription-1"]);
  });

  it("attempts every remaining channel when one provider call throws", async () => {
    const attempted: string[] = [];
    const deregister = vi.fn<DeregisterMock>((channel) => {
      attempted.push(String(channel.providerChannelId));
      if (channel.providerChannelId === "google-channel-2") {
        return Promise.reject(new Error("watch channel already gone"));
      }
      return Promise.resolve();
    });
    const dependencies = makeDependencies({
      listLiveChannels: vi.fn(() => Promise.resolve([
        makeChannel({ id: "channel-1", providerChannelId: "google-channel-1" }),
        makeChannel({ id: "channel-2", providerChannelId: "google-channel-2" }),
        makeChannel({ id: "channel-3", providerChannelId: "google-channel-3" }),
      ])),
      resolveRegistrar: vi.fn((provider: string) => makeRegistrar(provider, deregister)),
    });

    await expect(resolveUserRunner()("user-1", dependencies)).resolves.toBe(2);

    expect(attempted).toEqual([
      "google-channel-1",
      "google-channel-2",
      "google-channel-3",
    ]);

    const [, slug] = dependencies.recordError.mock.calls[0] as [unknown, string];
    expect(slug).toBe(DEREGISTRATION_FAILED_SLUG);
    expect(dependencies.observe).toHaveBeenCalledWith(expect.objectContaining({
      "push_channel.disconnect_deregistered_count": 2,
      "push_channel.disconnect_live_count": 3,
    }));
  });
});

interface ProxyQuery {
  method: string;
  params: unknown[];
  sql: string;
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

const makeRow = (overrides: Partial<SeededChannelRow>): SeededChannelRow => {
  const isoNow = NOW.toISOString();

  return {
    accountId: "account-a",
    calendarId: "cal-a",
    createdAt: isoNow,
    expiresAt: new Date(NOW.getTime() + 600_000).toISOString(),
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
  };
};

const seedChannelRows = (): SeededChannelRow[] => [
  makeRow({ id: "row-active", providerChannelId: "google-active", state: "active" }),
  makeRow({ id: "row-degraded", providerChannelId: "google-degraded", state: "degraded" }),
  makeRow({ id: "row-failed", providerChannelId: "google-failed", state: "failed" }),
  makeRow({ id: "row-failed-unstoppable", providerChannelId: null, state: "failed" }),
  makeRow({
    accountId: "account-b",
    calendarId: "cal-b",
    id: "row-other-user",
    providerChannelId: "google-other-user",
    state: "failed",
    userId: "user-b",
  }),
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

const parameterIndexes = (fragment: string): number[] =>
  [...fragment.matchAll(/\$(\d+)/gu)].map(([, index]) => Number(index));

const matchingRows = (
  rows: SeededChannelRow[],
  sql: string,
  params: unknown[],
): SeededChannelRow[] => {
  const scope = /"calendar_push_channels"\."(\w+)" = \$(\d+)/u.exec(sql);
  const states = /"calendar_push_channels"\."state" in \(([^)]*)\)/u.exec(sql);

  if (scope === null || states === null) {
    throw new Error(`Unexpected push channel query shape: ${sql}`);
  }

  const scopeColumn = scope[1] as keyof SeededChannelRow;
  const scopeValue = params[Number(scope[2]) - 1];
  const wantedStates = new Set(parameterIndexes(states[1] as string)
    .map((index) => params[index - 1]));

  return rows.filter((row) =>
    row[scopeColumn] === scopeValue && wantedStates.has(row.state));
};

const createProxyDatabase = (queries: ProxyQuery[], rows: SeededChannelRow[]) => {
  const credentialsRow = [
    "access-token-a",
    "account-a",
    new Date(NOW.getTime() + 3_600_000).toISOString(),
    "oauth-credential-a",
    "refresh-token-a",
  ];

  return drizzle((sql, params, method) => {
    queries.push({ method, params, sql });

    if (sql.includes("\"calendar_push_channels\"")) {
      const names = selectedNames(sql);
      return Promise.resolve({
        rows: matchingRows(rows, sql, params).map((row) =>
          names.map((name) => row[name as keyof SeededChannelRow])),
      });
    }

    if (sql.includes("\"oauth_credentials\"")) {
      return Promise.resolve({ rows: [credentialsRow] });
    }

    throw new Error(`Unexpected query: ${sql}`);
  });
};

const channelQueries = (queries: ProxyQuery[]): ProxyQuery[] =>
  queries.filter((query) => query.sql.includes("\"calendar_push_channels\""));

const requestedStates = (query: ProxyQuery): unknown[] => {
  const states = /"calendar_push_channels"\."state" in \(([^)]*)\)/u.exec(query.sql);
  if (states === null) {
    throw new Error(`Push channel query carried no state filter: ${query.sql}`);
  }
  return parameterIndexes(states[1] as string).map((index) => query.params[index - 1]);
};

const stoppedChannelIds = (fetchStub: Mock): string[] =>
  fetchStub.mock.calls.map(([, init]) =>
    (JSON.parse(String((init as RequestInit).body)) as { id: string }).id);

const installScopingHarness = async () => {
  const queries: ProxyQuery[] = [];
  const rows = seedChannelRows();
  const fetchStub = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));

  vi.spyOn(globalThis, "fetch").mockImplementation(
    fetchStub as unknown as typeof globalThis.fetch,
  );

  vi.doMock("@/context", () => ({
    database: createProxyDatabase(queries, rows),
    env: {},
    refreshLockStore: {
      release: () => Promise.resolve(),
      tryAcquire: () => Promise.resolve(true),
    },
    webhookConfig: {
      googleCallbackUrl: "https://example.com/api/webhook/google",
      outlookCallbackUrl: "https://example.com/api/webhook/outlook",
    },
  }));
  vi.resetModules();

  const deregistration = await import("../../../src/utils/push-notifications/deregister-account-channels");

  return { deregistration, fetchStub, queries };
};

describe("push channel teardown SQL scoping for a deleted user", () => {
  afterEach(() => {
    vi.doUnmock("@/context");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("stops the user's failed channels alongside the live ones without touching another user", async () => {
    const { deregistration, fetchStub, queries } = await installScopingHarness();

    await expect(deregistration.deregisterUserPushChannels("user-a"))
      .resolves.toHaveProperty("deregisteredCount", 3);

    const [query] = channelQueries(queries);
    expect(query).toBeDefined();
    expect((query as ProxyQuery).sql)
      .toContain("\"calendar_push_channels\".\"userId\" = $1");
    expect((query as ProxyQuery).params[0]).toBe("user-a");
    expect(requestedStates(query as ProxyQuery).toSorted())
      .toEqual(["active", "degraded", "failed", "registering"]);

    expect(stoppedChannelIds(fetchStub as unknown as Mock))
      .toEqual(["google-active", "google-degraded", "google-failed"]);
  });

  it("keeps the account scoped disconnect path away from failed channels", async () => {
    const { deregistration, queries } = await installScopingHarness();

    await deregistration.deregisterAccountPushChannels("account-a");

    const [query] = channelQueries(queries);
    expect(query).toBeDefined();
    expect((query as ProxyQuery).sql)
      .toContain("\"calendar_push_channels\".\"accountId\" = $1");
    expect(requestedStates(query as ProxyQuery)).not.toContain("failed");
  });

  it("keeps the calendar scoped disconnect path away from failed channels", async () => {
    const { deregistration, queries } = await installScopingHarness();

    await deregistration.deregisterCalendarPushChannels("cal-a");

    const [query] = channelQueries(queries);
    expect(query).toBeDefined();
    expect((query as ProxyQuery).sql)
      .toContain("\"calendar_push_channels\".\"calendarId\" = $1");
    expect(requestedStates(query as ProxyQuery)).not.toContain("failed");
  });
});
