import { afterEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import { pushChannelStateSchema } from "@keeper.sh/data-schemas";
import { LIVE_PUSH_CHANNEL_STATES } from "@keeper.sh/calendar";
import type { PushChannelState } from "@keeper.sh/calendar";

const NOW = new Date("2026-08-25T06:15:33.956Z");
const ISO_NOW = NOW.toISOString();
const HOUR_MS = 3_600_000;
const NO_CONTENT = 204;
const STOPPED_STATE = "removed";
const DELETED_USER_ID = "user-a";
const RETAINED_USER_ID = "user-b";

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

interface ProxyWrite {
  params: unknown[];
  sql: string;
}

const schemaBranchUnit = (branch: unknown): string => {
  if (typeof branch !== "object" || branch === null || !("unit" in branch)) {
    throw new Error(
      `Unexpected push channel state schema branch ${JSON.stringify(branch)}`,
    );
  }
  return String((branch as { unit: unknown }).unit);
};

const schemaPushChannelStates = (): string[] => {
  const branches: unknown = pushChannelStateSchema.json;
  if (!Array.isArray(branches)) {
    throw new TypeError(
      `Push channel state schema is not a union of literals: ${JSON.stringify(branches)}`,
    );
  }
  return branches.map((branch) => schemaBranchUnit(branch));
};

const canonicalPushChannelStates = async (): Promise<readonly PushChannelState[]> => {
  const calendarPackage = await import("@keeper.sh/calendar");
  const exported = (calendarPackage as {
    PUSH_CHANNEL_STATES?: readonly PushChannelState[];
  }).PUSH_CHANNEL_STATES;

  if (exported === undefined) {
    throw new Error(
      "@keeper.sh/calendar exports no canonical PUSH_CHANNEL_STATES enumeration, so the deleted-user push channel sweep cannot derive its states from the canonical union",
    );
  }

  return exported;
};

const channelRowId = (userId: string, state: string): string => `channel-${userId}-${state}`;

const providerChannelIdFor = (userId: string, state: string): string =>
  `google-${userId}-${state}`;

const makeRow = (userId: string, state: string): SeededChannelRow => ({
  accountId: `account-${userId}`,
  calendarId: `cal-${userId}-${state}`,
  createdAt: ISO_NOW,
  expiresAt: new Date(NOW.getTime() + HOUR_MS).toISOString(),
  failureCount: 0,
  id: channelRowId(userId, state),
  lastFailureAt: null,
  lastNotificationAt: null,
  nextAttemptAt: null,
  provider: "google",
  providerChannelId: providerChannelIdFor(userId, state),
  providerResourceId: `resource-${userId}-${state}`,
  reauthorizeRequestedAt: null,
  resourcePath: "/calendars/primary/events",
  secretHash: "b".repeat(64),
  state,
  updatedAt: ISO_NOW,
  userId,
  verifiedAt: ISO_NOW,
});

const seedRows = (states: readonly string[]): SeededChannelRow[] =>
  [DELETED_USER_ID, RETAINED_USER_ID].flatMap((userId) =>
    states.map((state) => makeRow(userId, state)));

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

const requestedStates = (sql: string, params: unknown[]): string[] => {
  const filter = /"calendar_push_channels"\."state" in \(([^)]*)\)/u.exec(sql);
  if (filter === null) {
    throw new Error(`Push channel query does not constrain state: ${sql}`);
  }

  return (filter[1] ?? "").split(",").map((placeholder) => {
    const position = /^\$(\d+)$/u.exec(placeholder.trim());
    if (position === null) {
      throw new Error(`Unparseable state placeholder ${placeholder} in ${sql}`);
    }
    return String(params[Number(position[1]) - 1]);
  });
};

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
  const states = requestedStates(sql, params);

  return rows.filter((row) =>
    row[scopeColumn] === scopeValue && states.includes(row.state));
};

const createProxyDatabase = (writes: ProxyWrite[], rows: SeededChannelRow[]) =>
  drizzle((sql, params) => {
    if (sql.startsWith("update ")) {
      writes.push({ params, sql });
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

const createStopFetchStub = (dialed: string[]) =>
  vi.fn((url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    if (!href.endsWith("channels/stop")) {
      throw new Error(`Unexpected provider request ${href}`);
    }

    const { id } = JSON.parse(String(init?.body)) as { id: string };
    dialed.push(id);
    return Promise.resolve(new Response(null, { status: NO_CONTENT }));
  });

const createHarness = async (states: readonly string[]) => {
  const dialed: string[] = [];
  const writes: ProxyWrite[] = [];

  vi.spyOn(globalThis, "fetch").mockImplementation(
    createStopFetchStub(dialed) as unknown as typeof globalThis.fetch,
  );

  vi.resetModules();

  vi.doMock("@/utils/logging", () => ({
    context: (run: () => unknown) => run(),
    destroy: () => Promise.resolve(),
    widelog: {
      error: () => undefined,
      errorFields: () => undefined,
      set: () => undefined,
      setFields: () => undefined,
    },
  }));

  vi.doMock("@/context", () => ({
    database: createProxyDatabase(writes, seedRows(states)),
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

  const module = await import("@/utils/push-notifications/deregister-account-channels");

  return {
    deregisterUserPushChannels: module.deregisterUserPushChannels,
    dialed,
    restatedChannelIds: (): string[] =>
      writes
        .filter((write) => write.params.includes(STOPPED_STATE))
        .flatMap((write) =>
          write.params.filter((param): param is string =>
            typeof param === "string" && param.startsWith("channel-"))),
  };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the deleted-user push channel sweep reads its states from the canonical set", () => {
  it("enumerates every state the canonical push channel union admits", async () => {
    const canonical = await canonicalPushChannelStates();

    expect([...canonical].toSorted()).toEqual(schemaPushChannelStates().toSorted());

    for (const live of LIVE_PUSH_CHANNEL_STATES) {
      expect(canonical).toContain(live);
    }
    expect(canonical).toContain(STOPPED_STATE);
  });

  it("dials and restates a deleted user's channel in every non-stopped canonical state", async () => {
    const canonical = await canonicalPushChannelStates();
    const sweptStates = canonical.filter((state) => state !== STOPPED_STATE);
    const harness = await createHarness(canonical);

    await expect(harness.deregisterUserPushChannels(DELETED_USER_ID)).resolves
      .toBe(sweptStates.length);

    expect(harness.dialed.toSorted()).toEqual(
      sweptStates
        .map((state) => providerChannelIdFor(DELETED_USER_ID, state))
        .toSorted(),
    );

    expect(harness.restatedChannelIds().toSorted()).toEqual(
      sweptStates.map((state) => channelRowId(DELETED_USER_ID, state)).toSorted(),
    );
  });

  it("leaves a stopped channel and another tenant's channels untouched", async () => {
    const canonical = await canonicalPushChannelStates();
    const harness = await createHarness(canonical);

    await harness.deregisterUserPushChannels(DELETED_USER_ID);

    expect(harness.dialed)
      .not.toContain(providerChannelIdFor(DELETED_USER_ID, STOPPED_STATE));
    expect(harness.restatedChannelIds())
      .not.toContain(channelRowId(DELETED_USER_ID, STOPPED_STATE));

    for (const state of canonical) {
      expect(harness.dialed).not.toContain(providerChannelIdFor(RETAINED_USER_ID, state));
      expect(harness.restatedChannelIds())
        .not.toContain(channelRowId(RETAINED_USER_ID, state));
    }
  });
});
