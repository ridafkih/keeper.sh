import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DELETED_USER_TOMBSTONE_TTL_SECONDS,
  createUserDeletedCheck,
  deletedUserTombstoneKey,
  resolvePushRegistrar,
} from "@keeper.sh/calendar";
import type { StoredPushChannel } from "@keeper.sh/calendar";
import { runDeregisterPushChannels } from "@/utils/push-notifications/deregister-account-channels";

const state = vi.hoisted(() => ({
  redisInstances: [] as unknown[],
}));

process.env.API_PORT ??= "3000";
process.env.BETTER_AUTH_SECRET ??= "test-secret";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.DATABASE_URL ??= "postgres://localhost:5432/keeper";
process.env.REDIS_URL ??= "redis://localhost:6379";

class FakeIoRedis {
  calls: string[] = [];
  store = new Map<string, string>();

  constructor() {
    state.redisInstances.push(this);
  }

  set(key: string, value: string, mode?: string, ttlSeconds?: number): Promise<string> {
    this.calls.push(`set:${key}:${mode ?? ""}:${ttlSeconds ?? ""}`);
    this.store.set(key, value);
    return Promise.resolve("OK");
  }

  exists(key: string): Promise<number> {
    return Promise.resolve(Number(this.store.has(key)));
  }

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.store.get(key) ?? null);
  }

  del(key: string): Promise<number> {
    return Promise.resolve(Number(this.store.delete(key)));
  }

  expire(key: string): Promise<number> {
    return Promise.resolve(Number(this.store.has(key)));
  }

  defineCommand(name: string): void {
    this.calls.push(`define:${name}`);
  }

  duplicate(): FakeIoRedis {
    const copy = new FakeIoRedis();
    for (const [key, value] of this.store) {
      copy.store.set(key, value);
    }
    return copy;
  }

  on(eventName: string): FakeIoRedis {
    this.calls.push(`on:${eventName}`);
    return this;
  }

  quit(): Promise<string> {
    this.store.clear();
    return Promise.resolve("OK");
  }
}

vi.mock("ioredis", () => ({ default: FakeIoRedis }));

vi.mock("@keeper.sh/database", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createDatabase: () => Promise.resolve({}),
}));

vi.mock("@keeper.sh/broadcast", () => ({
  createBroadcastService: () => ({
    emit: (userId: string) => userId,
  }),
}));

vi.mock("@keeper.sh/premium", () => ({
  createPremiumService: () => ({}),
}));

interface LoggedError {
  error: unknown;
  fields: Record<string, unknown>;
}

const loggedErrors: LoggedError[] = [];
const loggedFields: Record<string, unknown>[] = [];

vi.mock("@/utils/logging", () => ({
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

const NOW = new Date("2026-08-25T06:15:33.956Z");
const CHANNEL_TTL_MS = 60_000;
const SECRET_HASH = "a".repeat(64);

const makeChannel = (overrides: Partial<StoredPushChannel>): StoredPushChannel => ({
  accountId: "account-A",
  calendarId: "cal1",
  createdAt: NOW,
  expiresAt: new Date(NOW.getTime() + CHANNEL_TTL_MS),
  failureCount: 0,
  id: "channel-A-1",
  lastFailureAt: null,
  lastNotificationAt: null,
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

const CHANNELS: StoredPushChannel[] = [
  makeChannel({}),
  makeChannel({
    accountId: "account-A-2",
    calendarId: "cal2",
    id: "channel-A-2",
    provider: "outlook",
    providerChannelId: "graph-A-2",
    providerResourceId: null,
  }),
  makeChannel({
    accountId: "account-B",
    calendarId: "cal9",
    id: "channel-B-1",
    providerChannelId: "google-B-1",
    providerResourceId: "resource-B-1",
    userId: "B",
  }),
];

const CALENDAR_IDS = new Map<string, string[]>([
  ["A", ["cal1", "cal2"]],
  ["B", ["cal9"]],
]);

const NO_CONTENT = 204;

const readBody = (init?: RequestInit): string => {
  if (typeof init?.body === "string") {
    return init.body;
  }
  return "";
};

interface Harness {
  dependencies: Record<string, unknown>;
  events: string[];
  redis: FakeIoRedis;
  remainingJobIds: () => string[];
  removedJobIds: string[];
  stoppedChannelIds: string[];
}

interface HarnessOverrides {
  deregisterPushChannels?: (userId: string) => Promise<unknown>;
}

const makeHarness = (overrides: HarnessOverrides = {}): Harness => {
  const events: string[] = [];
  const redis = new FakeIoRedis();
  const removedJobIds: string[] = [];
  const stoppedChannelIds: string[] = [];
  const jobIds = new Set(["sync-A-cal1", "sync-A-cal2", "sync-B-cal9", "sync-B-cal10"]);

  const trackingRedis = {
    exists: (key: string) => redis.exists(key),
    set: (key: string, value: string, mode: "EX", ttlSeconds: number) => {
      events.push(`tombstone:${key}:${ttlSeconds}`);
      return redis.set(key, value, mode, ttlSeconds);
    },
  };

  const queue = {
    remove: (jobId: string) => {
      events.push(`job-remove:${jobId}`);
      if (!jobIds.delete(jobId)) {
        return Promise.resolve(0);
      }
      removedJobIds.push(jobId);
      return Promise.resolve(1);
    },
  };

  const stubFetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = readBody(init);
    for (const channel of CHANNELS) {
      const channelId = channel.providerChannelId;
      if (channelId !== null && (url.includes(channelId) || body.includes(channelId))) {
        stoppedChannelIds.push(channelId);
      }
    }
    return Promise.resolve(new Response(null, { status: NO_CONTENT }));
  }) as typeof globalThis.fetch;

  const composedDeregister = (userId: string) =>
    runDeregisterPushChannels(userId, {
      createRegistrarContext: (channel) => {
        events.push(`deregister-context:${channel.providerChannelId}`);
        return Promise.resolve({
          accessToken: "token",
          channelId: channel.providerChannelId,
          fetchImpl: stubFetch,
          notificationUrl: "https://keeper.example/api/webhook/google",
          now: NOW,
          requestedExpiresAt: NOW,
        });
      },
      listLiveChannels: (scopeId: string) => {
        events.push(`deregister-list:${scopeId}`);
        return Promise.resolve(CHANNELS.filter((channel) => channel.userId === scopeId));
      },
      observe: (fields: Record<string, unknown>) => {
        loggedFields.push(fields);
      },
      recordError: (error: unknown, slug: string) => {
        loggedErrors.push({ error, fields: { slug } });
      },
      resolveRegistrar: resolvePushRegistrar,
      webhookConfigured: true,
    });

  return {
    dependencies: {
      createQueue: () => queue,
      deregisterPushChannels: overrides.deregisterPushChannels ?? composedDeregister,
      listCalendarIds: (userId: string) => {
        events.push(`list-calendars:${userId}`);
        return Promise.resolve(CALENDAR_IDS.get(userId) ?? []);
      },
      redis: trackingRedis,
    },
    events,
    redis,
    remainingJobIds: () => [...jobIds],
    removedJobIds,
    stoppedChannelIds,
  };
};

const importTeardownModule = async () => await import("@/utils/delete-user-teardown");

beforeEach(() => {
  loggedErrors.length = 0;
  loggedFields.length = 0;
  state.redisInstances.length = 0;
});

describe("delete user sync teardown", () => {
  it("tombstones, drains jobs and deregisters channels for only the deleted user", async () => {
    const { createDeleteUserSyncTeardown } = await importTeardownModule();
    const harness = makeHarness();
    const tombstoneEvent = `tombstone:${deletedUserTombstoneKey("A")}:${DELETED_USER_TOMBSTONE_TTL_SECONDS}`;

    await createDeleteUserSyncTeardown(harness.dependencies as never)("A");

    await expect(createUserDeletedCheck(harness.redis, "A")()).resolves.toBe(true);
    await expect(createUserDeletedCheck(harness.redis, "B")()).resolves.toBe(false);

    expect(harness.events.at(0)).toBe(tombstoneEvent);
    expect(harness.events.filter((event) => event.startsWith("job-remove:"))).toEqual([
      "job-remove:sync-A-cal1",
      "job-remove:sync-A-cal2",
    ]);
    expect(harness.removedJobIds).toEqual(["sync-A-cal1", "sync-A-cal2"]);
    expect(harness.remainingJobIds()).toEqual(["sync-B-cal9", "sync-B-cal10"]);

    expect(harness.events).toContain("deregister-list:A");
    expect(harness.events.some((event) => event.includes("deregister-list:B"))).toBe(false);
    expect(harness.stoppedChannelIds.toSorted()).toEqual(["google-A-1", "graph-A-2"]);

    const tombstoneIndex = harness.events.indexOf(tombstoneEvent);

    expect(tombstoneIndex).toBeLessThan(harness.events.indexOf("job-remove:sync-A-cal1"));
    expect(tombstoneIndex).toBeLessThan(harness.events.indexOf("deregister-list:A"));
  });

  it("keeps the tombstone and job drain when deregistration fails, and resolves", async () => {
    const { createDeleteUserSyncTeardown } = await importTeardownModule();
    const harness = makeHarness({
      deregisterPushChannels: () => Promise.reject(new Error("graph subscription delete failed")),
    });

    await expect(
      createDeleteUserSyncTeardown(harness.dependencies as never)("A"),
    ).resolves.toBeUndefined();

    await expect(createUserDeletedCheck(harness.redis, "A")()).resolves.toBe(true);
    expect(harness.removedJobIds).toEqual(["sync-A-cal1", "sync-A-cal2"]);
    expect(loggedErrors.map((entry) => entry.fields.slug)).toContain(
      "delete-user-teardown-failed",
    );
  });
});

describe("production auth wiring", () => {
  it("writes the tombstone when beforeDelete runs on the api auth instance", async () => {
    const { auth } = await import("@/context");
    const beforeDelete = auth.options.user?.deleteUser?.beforeDelete;

    expect(beforeDelete).toBeTypeOf("function");

    const runBeforeDelete = beforeDelete as (
      user: { id: string },
      request: unknown,
    ) => Promise<void>;

    await runBeforeDelete({ id: "A" }, {});

    const [firstRedis] = state.redisInstances;

    if (!(firstRedis instanceof FakeIoRedis)) {
      throw new TypeError("expected the api context to construct a fake redis client");
    }

    await expect(firstRedis.exists(deletedUserTombstoneKey("A"))).resolves.toBe(1);
  });
});
