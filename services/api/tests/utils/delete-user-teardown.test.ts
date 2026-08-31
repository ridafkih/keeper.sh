import { describe, expect, it, vi } from "vitest";
import {
  DELETED_USER_TOMBSTONE_TTL_SECONDS,
  PRESENT_ANSWER_FRESHNESS_MS,
  createUserDeletedCheck,
  deletedUserTombstoneKey,
  resolvePushRegistrar,
  unconfirmedDeletionMarkerKey,
} from "@keeper.sh/calendar";
import type { StoredPushChannel } from "@keeper.sh/calendar";
import { runDeregisterPushChannels } from "@/utils/push-notifications/deregister-account-channels";

process.env.API_PORT ??= "3000";
process.env.BETTER_AUTH_SECRET ??= "test-secret";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.DATABASE_URL ??= "postgres://localhost:5432/keeper";
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.REDIS_URL ??= "redis://localhost:6379";

class FakeIoRedis {
  calls: string[] = [];
  store = new Map<string, string>();

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

interface EmptyRowQuery {
  from: () => EmptyRowQuery;
  leftJoin: () => EmptyRowQuery;
  where: () => Promise<never[]>;
}

const emptyRowQuery = (): EmptyRowQuery => {
  const query: EmptyRowQuery = {
    from: () => query,
    leftJoin: () => query,
    where: () => Promise.resolve([]),
  };

  return query;
};

vi.mock("@keeper.sh/database", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createDatabase: () => Promise.resolve({ select: () => emptyRowQuery() }),
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

interface WideEventCapture {
  loggedErrors: LoggedError[];
  loggedFields: Record<string, unknown>[];
}

vi.mock("@/utils/logging", () => {
  const loggedErrors: LoggedError[] = [];
  const loggedFields: Record<string, unknown>[] = [];

  return {
    context: (run: () => unknown) => run(),
    destroy: () => Promise.resolve(),
    startWideEventCapture: (): WideEventCapture => {
      loggedErrors.length = 0;
      loggedFields.length = 0;
      return { loggedErrors, loggedFields };
    },
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
  };
});

const startWideEventCapture = async (): Promise<WideEventCapture> => {
  const logging = (await import("@/utils/logging")) as unknown as {
    startWideEventCapture: () => WideEventCapture;
  };

  return logging.startWideEventCapture();
};

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

const seedChannels = (): StoredPushChannel[] => [
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

const seedCalendarIds = (channels: StoredPushChannel[]): Map<string, string[]> => {
  const calendarIds = new Map<string, string[]>();

  for (const channel of channels) {
    if (channel.calendarId === null) {
      continue;
    }

    calendarIds.set(channel.userId, [
      ...(calendarIds.get(channel.userId) ?? []),
      channel.calendarId,
    ]);
  }

  return calendarIds;
};

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
  loggedErrors: LoggedError[];
  loggedFields: Record<string, unknown>[];
  redis: FakeIoRedis;
  remainingJobIds: () => string[];
  removedJobIds: string[];
  stoppedChannelIds: string[];
}

interface HarnessOverrides {
  deregisterPushChannels?: (userId: string) => Promise<unknown>;
  lockedJobIds?: string[];
}

const makeHarness = async (overrides: HarnessOverrides = {}): Promise<Harness> => {
  const { loggedErrors, loggedFields } = await startWideEventCapture();
  const channels = seedChannels();
  const calendarIds = seedCalendarIds(channels);
  const events: string[] = [];
  const redis = new FakeIoRedis();
  const removedJobIds: string[] = [];
  const stoppedChannelIds: string[] = [];
  const jobIds = new Map(
    ["sync-A-cal1", "sync-A-cal2", "sync-B-cal9", "sync-B-cal10"].map(
      (jobId) => [jobId, { id: jobId }] as const,
    ),
  );

  const trackingRedis = {
    exists: (key: string) => redis.exists(key),
    set: (key: string, value: string, mode: "EX", ttlSeconds: number) => {
      events.push(`tombstone:${key}:${ttlSeconds}`);
      return redis.set(key, value, mode, ttlSeconds);
    },
  };

  const lockedJobIds = new Set(overrides.lockedJobIds);

  const queue = {
    getJob: (jobId: string) => Promise.resolve(jobIds.get(jobId)),
    remove: (jobId: string) => {
      events.push(`job-remove:${jobId}`);
      if (lockedJobIds.has(jobId)) {
        return Promise.resolve(0);
      }
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
    for (const channel of channels) {
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
        return Promise.resolve(channels.filter((channel) => channel.userId === scopeId));
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
      fetchImpl: () => Promise.reject(new Error("no oauth revocation expected here")),
      listCalendarIds: (userId: string) => {
        events.push(`list-calendars:${userId}`);
        return Promise.resolve(calendarIds.get(userId) ?? []);
      },
      listOAuthGrantProviders: () => Promise.resolve([]),
      listPushChannels: () => Promise.resolve([]),
      redis: trackingRedis,
      residue: {
        clear: () => Promise.resolve(),
        list: () => Promise.resolve([]),
        record: () => Promise.resolve(),
      },
    },
    events,
    loggedErrors,
    loggedFields,
    redis,
    remainingJobIds: () => [...jobIds.keys()],
    removedJobIds,
    stoppedChannelIds,
  };
};

const importTeardownModule = async () => await import("@/utils/delete-user-teardown");

describe("delete user sync teardown", () => {
  it("tombstones, drains jobs and deregisters channels for only the deleted user", async () => {
    const { createDeleteUserSyncTeardown } = await importTeardownModule();
    const harness = await makeHarness();
    const tombstoneEvent = `tombstone:${deletedUserTombstoneKey("A")}:${DELETED_USER_TOMBSTONE_TTL_SECONDS}`;
    const markerEvent = `tombstone:${unconfirmedDeletionMarkerKey("A")}:${DELETED_USER_TOMBSTONE_TTL_SECONDS}`;

    await createDeleteUserSyncTeardown(harness.dependencies as never)("A");

    await expect(createUserDeletedCheck(harness.redis, "A")()).resolves.toBe(true);
    await expect(createUserDeletedCheck(harness.redis, "B")()).resolves.toBe(false);

    expect(harness.events.at(0)).toBe(markerEvent);
    expect(harness.events.at(1)).toBe(tombstoneEvent);
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
    const harness = await makeHarness({
      deregisterPushChannels: () => Promise.reject(new Error("graph subscription delete failed")),
    });

    await expect(
      createDeleteUserSyncTeardown(harness.dependencies as never)("A"),
    ).resolves.toBeUndefined();

    await expect(createUserDeletedCheck(harness.redis, "A")()).resolves.toBe(true);
    expect(harness.removedJobIds).toEqual(["sync-A-cal1", "sync-A-cal2"]);
    expect(harness.loggedErrors.map((entry) => entry.fields.slug)).toContain(
      "delete-user-teardown-failed",
    );
  });
});

describe("delete user teardown with an in-flight sync run", () => {
  it("records the job it could not remove on the wide event and still completes the deletion", async () => {
    const { createDeleteUserSyncTeardown } = await importTeardownModule();
    const harness = await makeHarness({ lockedJobIds: ["sync-A-cal2"] });

    await expect(
      createDeleteUserSyncTeardown(harness.dependencies as never)("A"),
    ).resolves.toBeUndefined();

    await expect(createUserDeletedCheck(harness.redis, "A")()).resolves.toBe(true);
    expect(harness.removedJobIds).toEqual(["sync-A-cal1"]);
    expect(harness.remainingJobIds()).toContain("sync-A-cal2");

    const merged = Object.assign({}, ...harness.loggedFields) as Record<string, unknown>;

    expect(merged["delete_user.sync_jobs_removed"]).toBe(1);
    expect(merged["delete_user.sync_jobs_unremovable"]).toBe(1);
    expect(harness.loggedErrors.map((entry) => entry.fields.slug)).not.toContain(
      "delete-user-teardown-failed",
    );
    expect(harness.events).toContain("deregister-list:A");
  });
});

describe("production auth wiring", () => {
  it("writes the tombstone when beforeDelete runs on the api auth instance", async () => {
    const { auth, redis } = await import("@/context");
    const beforeDelete = auth.options.user?.deleteUser?.beforeDelete;

    expect(beforeDelete).toBeTypeOf("function");

    const runBeforeDelete = beforeDelete as (
      user: { id: string },
      request: unknown,
    ) => Promise<void>;

    await runBeforeDelete({ id: "A" }, {});

    if (!(redis instanceof FakeIoRedis)) {
      throw new TypeError("expected the api context to construct a fake redis client");
    }

    await expect(redis.exists(deletedUserTombstoneKey("A"))).resolves.toBe(1);
  });
});

interface TombstoneRedisCall {
  args: unknown[];
  op: "set" | "exists" | "get";
}

interface TombstoneRedisFake {
  calls: TombstoneRedisCall[];
  exists: (key: string) => Promise<number>;
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, mode: "EX", ttlSeconds: number) => Promise<string>;
  store: Map<string, string>;
}

const OOM_MESSAGE = "OOM command not allowed when used memory > 'maxmemory'.";

const makeTombstoneRedis = (failures: number): TombstoneRedisFake => {
  const calls: TombstoneRedisCall[] = [];
  const store = new Map<string, string>();
  let attempts = 0;

  return {
    calls,
    exists: (key: string) => {
      calls.push({ args: [key], op: "exists" });
      return Promise.resolve(Number(store.has(key)));
    },
    get: (key: string) => {
      calls.push({ args: [key], op: "get" });
      return Promise.resolve(store.get(key) ?? null);
    },
    set: (key: string, value: string, mode: "EX", ttlSeconds: number) => {
      calls.push({ args: [key, value, mode, ttlSeconds], op: "set" });
      attempts += 1;
      if (attempts <= failures) {
        return Promise.reject(new Error(OOM_MESSAGE));
      }
      store.set(key, value);
      return Promise.resolve("OK");
    },
    store,
  };
};

const ALWAYS_FAILING = Number.MAX_SAFE_INTEGER;

describe("tombstone durability", () => {
  it("retries the tombstone write and reads the key back before the step is done", async () => {
    const { createDeleteUserSyncTeardown } = await importTeardownModule();
    const harness = await makeHarness();
    const redis = makeTombstoneRedis(1);
    const key = deletedUserTombstoneKey("A");

    await createDeleteUserSyncTeardown({
      ...harness.dependencies,
      redis,
    } as never)("A");

    const setCalls = redis.calls.filter((call) => call.op === "set");

    expect(setCalls.length).toBeGreaterThanOrEqual(2);
    expect(
      setCalls.every(
        (call) => call.args[0] === key || call.args[0] === unconfirmedDeletionMarkerKey("A"),
      ),
    ).toBe(true);
    expect(setCalls.every((call) => call.args[3] === DELETED_USER_TOMBSTONE_TTL_SECONDS)).toBe(
      true,
    );

    const lastSetIndex = redis.calls.findLastIndex((call) => call.op === "set");
    const readBack = redis.calls
      .slice(lastSetIndex + 1)
      .find((call) => call.op !== "set" && call.args[0] === key);

    expect(readBack).toBeDefined();
    expect(redis.store.get(key)).toBeDefined();

    expect(
      harness.loggedErrors.filter(
        (entry) => entry.fields.prefix === "delete_user_teardown.tombstone",
      ),
    ).toEqual([]);
  });

  it("blocks deletion and records one tombstone error when redis stays OOM", async () => {
    const { createDeleteUserSyncTeardown } = await importTeardownModule();
    const harness = await makeHarness();
    const redis = makeTombstoneRedis(ALWAYS_FAILING);

    await expect(
      createDeleteUserSyncTeardown({ ...harness.dependencies, redis } as never)("A"),
    ).rejects.toThrow(/tombstone/);

    const setCalls = redis.calls.filter((call) => call.op === "set");

    expect(setCalls.length).toBeGreaterThanOrEqual(2);
    expect(harness.removedJobIds).toEqual([]);
    expect(harness.stoppedChannelIds).toEqual([]);

    const tombstoneErrors = harness.loggedErrors.filter(
      (entry) => entry.fields.prefix === "delete_user_teardown.tombstone",
    );

    expect(tombstoneErrors).toHaveLength(1);
    expect(tombstoneErrors.map((entry) => String(entry.error)).join(" ")).toContain("OOM");
    expect(tombstoneErrors[0]?.fields.slug).toBe("delete-user-teardown-blocked");
    expect(tombstoneErrors[0]?.fields.retriable).toBe(true);
  });
});

describe("delete user teardown interrupted before compensation runs", () => {
  it("keeps a surviving user out of the deleted answer when the process dies before the row delete", async () => {
    const { createDeleteUserSyncTeardown } = await importTeardownModule();
    const harness = await makeHarness();

    await createDeleteUserSyncTeardown(harness.dependencies as never)("A");

    const probeErrors: unknown[] = [];
    let userRowProbes = 0;
    const isUserDeleted = createUserDeletedCheck(harness.redis, "A", {
      freshnessWindowMs: PRESENT_ANSWER_FRESHNESS_MS,
      isUserRowPresent: () => {
        userRowProbes += 1;
        return Promise.resolve(true);
      },
      onProbeError: (error) => {
        probeErrors.push(error);
      },
    });

    await expect(isUserDeleted()).resolves.toBe(false);
    expect(userRowProbes).toBeGreaterThan(0);
    expect(probeErrors).toEqual([]);
  });
});

describe("a blocked tombstone", () => {
  it("stops the teardown and is reported as a retryable refusal", async () => {
    const { createDeleteUserSyncTeardown } = await importTeardownModule();
    const harness = await makeHarness();
    const redis = makeTombstoneRedis(ALWAYS_FAILING);

    const rejection: unknown = await createDeleteUserSyncTeardown({
      ...harness.dependencies,
      redis,
    } as never)("A").then(
      () => {
        throw new Error(
          "teardown resolved, so the user row is deleted with no durable halt signal standing",
        );
      },
      (error: unknown) => error,
    );

    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).name).toBe("TeardownBlockedError");
    expect((rejection as Error).message).toContain("tombstone");

    expect(harness.removedJobIds).toEqual([]);
    expect(harness.stoppedChannelIds).toEqual([]);
    expect(harness.events.some((event) => event.startsWith("job-remove:"))).toBe(false);
    expect(harness.events).not.toContain("deregister-list:A");

    const tombstoneErrors = harness.loggedErrors.filter(
      (entry) => entry.fields.prefix === "delete_user_teardown.tombstone",
    );

    expect(tombstoneErrors).toHaveLength(1);
    expect(String(tombstoneErrors[0]?.error)).toContain("OOM");
    expect(tombstoneErrors[0]?.fields.slug).toBe("delete-user-teardown-blocked");
    expect(tombstoneErrors[0]?.fields.retriable).toBe(true);
    expect(tombstoneErrors[0]?.fields["delete_user.blocked_step"]).toBe("tombstone");
  });
});
