import { describe, expect, it, vi } from "vitest";
import {
  FULL_POLL_INTERVAL_MS,
  createUserDeletedCheck,
  planPushChannelActions,
  resolveIngestPollFloorMs,
  resolvePushChannelHealth,
  resolvePushRegistrar,
} from "@keeper.sh/calendar";
import type { EligibleSourceCalendar, StoredPushChannel } from "@keeper.sh/calendar";
import { runDeregisterPushChannels } from "@/utils/push-notifications/deregister-account-channels";

interface LoggedError {
  error: unknown;
  fields: Record<string, unknown>;
}

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

const NOW = new Date("2026-08-25T06:15:33.956Z");
const ONE_MINUTE_MS = 60_000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const ONE_MINUTE_LATER = new Date(NOW.getTime() + ONE_MINUTE_MS);
const SECRET_HASH = "a".repeat(64);
const NO_CONTENT = 204;
const SERVER_ERROR = 500;
const UNSTOPPABLE_PROVIDER_CHANNEL_ID = "google-A-2";

const makeChannel = (overrides: Partial<StoredPushChannel>): StoredPushChannel => ({
  accountId: "account-A",
  calendarId: "cal-A-1",
  createdAt: NOW,
  expiresAt: new Date(NOW.getTime() + SEVEN_DAYS_MS),
  failureCount: 0,
  id: "channel-A-1",
  lastFailureAt: null,
  lastNotificationAt: NOW,
  nextAttemptAt: null,
  provider: "google",
  providerChannelId: "google-A-1",
  providerResourceId: "resource-A-1",
  reauthorizeRequestedAt: null,
  resourcePath: "/calendars/primary/events",
  secretHash: SECRET_HASH,
  state: "active",
  updatedAt: NOW,
  userId: "A",
  verifiedAt: NOW,
  ...overrides,
});

const seedChannels = (): StoredPushChannel[] => [
  makeChannel({}),
  makeChannel({
    accountId: "account-A-2",
    calendarId: "cal-A-2",
    id: "channel-A-2",
    providerChannelId: UNSTOPPABLE_PROVIDER_CHANNEL_ID,
    providerResourceId: "resource-A-2",
  }),
  makeChannel({
    accountId: "account-B",
    calendarId: "cal-B-1",
    id: "channel-B-1",
    providerChannelId: "google-B-1",
    providerResourceId: "resource-B-1",
    userId: "B",
  }),
];

interface ChannelStore {
  listByUser: (userId: string) => Promise<StoredPushChannel[]>;
  markChannelStopped: (
    channelId: string,
    patch?: Partial<StoredPushChannel>,
  ) => Promise<void>;
  markChannelsStopped: (
    channelIds: string[],
    patch?: Partial<StoredPushChannel>,
  ) => Promise<void>;
  rowById: (channelId: string) => StoredPushChannel;
  rows: () => StoredPushChannel[];
}

const createChannelStore = (): ChannelStore => {
  const rows = new Map(seedChannels().map((channel) => [channel.id, channel] as const));
  const stoppedRowPatch: Partial<StoredPushChannel> = {
    expiresAt: null,
    lastNotificationAt: null,
    state: "removed",
    verifiedAt: null,
  };

  const applyStop = (channelId: string, patch?: Partial<StoredPushChannel>): void => {
    const row = rows.get(channelId);
    if (!row) {
      throw new Error(`Push channel row ${channelId} is not seeded in the store`);
    }
    rows.set(channelId, {
      ...row,
      ...stoppedRowPatch,
      ...patch,
      updatedAt: ONE_MINUTE_LATER,
    });
  };

  return {
    listByUser: (userId) =>
      Promise.resolve([...rows.values()].filter((row) => row.userId === userId)),
    markChannelStopped: (channelId, patch) => {
      applyStop(channelId, patch);
      return Promise.resolve();
    },
    markChannelsStopped: (channelIds, patch) => {
      for (const channelId of channelIds) {
        applyStop(channelId, patch);
      }
      return Promise.resolve();
    },
    rowById: (channelId) => {
      const row = rows.get(channelId);
      if (!row) {
        throw new Error(`Push channel row ${channelId} is not seeded in the store`);
      }
      return row;
    },
    rows: () => [...rows.values()],
  };
};

const readStoppedChannelId = (init?: RequestInit): string => {
  if (typeof init?.body !== "string") {
    throw new TypeError("Provider stop request carried no JSON body");
  }
  return (JSON.parse(init.body) as { id: string }).id;
};

interface Harness {
  channelStore: ChannelStore;
  loggedErrors: () => LoggedError[];
  loggedFields: () => Record<string, unknown>[];
  rollbackDependencies: Record<string, unknown>;
  stopRequests: () => string[];
  teardownDependencies: Record<string, unknown>;
  tombstoneRedis: {
    del: (key: string) => Promise<number>;
    exists: (key: string) => Promise<number>;
    set: (key: string, value: string, mode: "EX", ttlSeconds: number) => Promise<string>;
  };
}

const makeHarness = (): Harness => {
  const channelStore = createChannelStore();
  const stopRequests: string[] = [];
  const loggedErrors: LoggedError[] = [];
  const loggedFields: Record<string, unknown>[] = [];
  const tombstones = new Map<string, string>();

  const tombstoneRedis = {
    del: (key: string) => Promise.resolve(Number(tombstones.delete(key))),
    exists: (key: string) => Promise.resolve(Number(tombstones.has(key))),
    set: (key: string, value: string) => {
      tombstones.set(key, value);
      return Promise.resolve("OK");
    },
  };

  const stubFetch = ((input: string | URL | Request, init?: RequestInit) => {
    const stoppedId = readStoppedChannelId(init);

    stopRequests.push(stoppedId);
    if (stoppedId === UNSTOPPABLE_PROVIDER_CHANNEL_ID) {
      return Promise.resolve(new Response(null, { status: SERVER_ERROR }));
    }
    return Promise.resolve(new Response(null, { status: NO_CONTENT }));
  }) as typeof globalThis.fetch;

  const deregisterDependencies = {
    createRegistrarContext: (channel: StoredPushChannel) =>
      Promise.resolve({
        accessToken: "token",
        channelId: channel.providerChannelId,
        fetchImpl: stubFetch,
        notificationUrl: "https://keeper.example/api/webhook/google",
        now: NOW,
        requestedExpiresAt: NOW,
      }),
    listLiveChannels: (scopeId: string) => channelStore.listByUser(scopeId),
    markChannelStopped: channelStore.markChannelStopped,
    markChannelsStopped: channelStore.markChannelsStopped,
    observe: (fields: Record<string, unknown>) => {
      loggedFields.push(fields);
    },
    recordError: (error: unknown, slug: string) => {
      loggedErrors.push({ error, fields: { slug } });
    },
    resolveRegistrar: resolvePushRegistrar,
    webhookConfigured: true,
  };

  const queue = {
    getJob: () => Promise.resolve({}),
    remove: () => Promise.resolve(0),
  };

  return {
    channelStore,
    loggedErrors: () => [...loggedErrors],
    loggedFields: () => [...loggedFields],
    rollbackDependencies: {
      markChannelStopped: channelStore.markChannelStopped,
      markChannelsStopped: channelStore.markChannelsStopped,
      redis: tombstoneRedis,
    },
    stopRequests: () => [...stopRequests],
    teardownDependencies: {
      createQueue: () => queue,
      deregisterPushChannels: (userId: string) =>
        runDeregisterPushChannels(userId, deregisterDependencies as never),
      listCalendarIds: () => Promise.resolve([]),
      markChannelStopped: channelStore.markChannelStopped,
      markChannelsStopped: channelStore.markChannelsStopped,
      redis: tombstoneRedis,
    },
    tombstoneRedis,
  };
};

const makeCalendar = (
  overrides: Partial<EligibleSourceCalendar>,
): EligibleSourceCalendar => ({
  accountId: "account-A",
  calendarId: "cal-A-1",
  capabilities: ["pull"],
  disabled: false,
  externalCalendarId: "primary",
  needsReauthentication: false,
  provider: "google",
  providerAccountId: "google-account-A",
  userId: "A",
  ...overrides,
});

const seedCalendars = (): EligibleSourceCalendar[] => [
  makeCalendar({}),
  makeCalendar({ accountId: "account-A-2", calendarId: "cal-A-2" }),
  makeCalendar({
    accountId: "account-B",
    calendarId: "cal-B-1",
    providerAccountId: "google-account-B",
    userId: "B",
  }),
];

const planActionsForCalendar = async (
  channels: StoredPushChannel[],
  calendarId: string,
) => {
  const actions = await planPushChannelActions({
    calendars: seedCalendars(),
    channels,
    now: ONE_MINUTE_LATER,
    onPlanError: (userId, error) => {
      throw new Error(`Unexpected plan error for ${userId}`, { cause: error });
    },
    resolvePlan: () => Promise.resolve("pro"),
    webhookPublicUrl: "https://keeper.example",
  });

  return actions.filter(
    (action) => action.scope.kind === "calendar" && action.scope.calendarId === calendarId,
  );
};

const runTeardownThenRollback = async (harness: Harness): Promise<void> => {
  const { createDeleteUserSyncTeardown, createDeleteUserSyncTeardownRollback } = await import(
    "@/utils/delete-user-teardown"
  );

  await createDeleteUserSyncTeardown(harness.teardownDependencies as never)("A");
  await createDeleteUserSyncTeardownRollback(harness.rollbackDependencies as never)("A");
};

describe("push channel rows after a delete that was rolled back", () => {
  it("stops each of the target user's channels exactly once and never touches another tenant", async () => {
    const harness = makeHarness();

    await runTeardownThenRollback(harness);

    expect(harness.stopRequests().toSorted()).toEqual([
      "google-A-1",
      UNSTOPPABLE_PROVIDER_CHANNEL_ID,
    ]);
    expect(harness.stopRequests()).not.toContain("google-B-1");
  });

  it("clears the tombstone so the surviving customer is not treated as deleted", async () => {
    const harness = makeHarness();

    await runTeardownThenRollback(harness);

    await expect(createUserDeletedCheck(harness.tombstoneRedis, "A")()).resolves.toBe(false);
  });

  it("restates the stopped row so the next planning tick registers a fresh channel", async () => {
    const harness = makeHarness();
    const seeded = harness.channelStore.rowById("channel-A-1");

    expect(seeded.state).toBe("active");
    await expect(planActionsForCalendar([seeded], "cal-A-1")).resolves.toEqual([]);

    await runTeardownThenRollback(harness);

    const stopped = harness.channelStore.rowById("channel-A-1");

    expect(stopped.state).not.toBe("active");

    const targetActions = await planActionsForCalendar(
      harness.channelStore.rows(),
      "cal-A-1",
    );

    expect(targetActions).toHaveLength(1);
    expect(targetActions[0]?.type).toBe("register");
    expect(targetActions[0]?.channel).toBeNull();
  });

  it("stops reporting the stopped channel as healthy and drops back to the full poll floor", async () => {
    const harness = makeHarness();
    const seeded = harness.channelStore.rowById("channel-A-1");

    expect(resolvePushChannelHealth(seeded, ONE_MINUTE_LATER).healthy).toBe(true);
    expect(resolveIngestPollFloorMs({
      channel: seeded,
      needsReauthentication: false,
      now: ONE_MINUTE_LATER,
      plan: "pro",
    })).not.toBe(FULL_POLL_INTERVAL_MS);

    await runTeardownThenRollback(harness);

    const stopped = harness.channelStore.rowById("channel-A-1");
    const health = resolvePushChannelHealth(stopped, ONE_MINUTE_LATER);

    expect(health.healthy).toBe(false);
    expect(health.reason).not.toBeNull();
    expect(resolveIngestPollFloorMs({
      channel: stopped,
      needsReauthentication: false,
      now: ONE_MINUTE_LATER,
      plan: "pro",
    })).toBe(FULL_POLL_INTERVAL_MS);
  });

  it("leaves the other tenant's row byte for byte untouched", async () => {
    const harness = makeHarness();
    const seededOther = seedChannels().find((channel) => channel.userId === "B");

    await runTeardownThenRollback(harness);

    expect(harness.channelStore.rowById("channel-B-1")).toEqual(seededOther);
  });

  it("does not restate a row whose provider stop failed", async () => {
    const harness = makeHarness();
    const seededUnstoppable = seedChannels().find(
      (channel) => channel.providerChannelId === UNSTOPPABLE_PROVIDER_CHANNEL_ID,
    );

    await runTeardownThenRollback(harness);

    expect(harness.channelStore.rowById("channel-A-2")).toEqual(seededUnstoppable);
  });
});
