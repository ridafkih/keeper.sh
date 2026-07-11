import { describe, expect, it } from "vitest";
import { createSyncAggregateRuntime } from "../../../src/core/sync/aggregate-runtime";
import type { SyncAggregateRuntimeConfig } from "../../../src/core/sync/aggregate-runtime";
import { SyncAggregateTracker } from "../../../src/core/sync/aggregate-tracker";
import type { DestinationSyncResult, SyncProgressUpdate } from "../../../src/core/sync/types";
import Redis from "ioredis";

const flushAsync = async (): Promise<void> => {
  for (let tick = 0; tick < 10; tick++) {
    await Promise.resolve();
  }
};

const parseJsonRecord = (value: string): Record<string, unknown> | null => {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
};

const createMockRedis = (): Redis => {
  const store = new Map<string, string>();

  const stub = (property: keyof Redis) => {
    switch (property) {
      case "incr": {
        return (key: string) => {
          const current = Number.parseInt(store.get(key) ?? "0", 10);
          const next = current + 1;
          store.set(key, String(next));
          return Promise.resolve(next);
        }
      }
      case "get": {
        return (key: string): Promise<string | null> => Promise.resolve(store.get(key) ?? null)
      }
      case "set": {
        return (key: string, value: string): Promise<"OK"> => {
          store.set(key, value);
          return Promise.resolve("OK");
        }
      }
      case "eval": {
        return (
          _script: string,
          _numberOfKeys: number,
          key: string,
          payload: string,
          sequence: string,
        ): Promise<number> => {
          const current = store.get(key);
          if (current) {
            const decoded = parseJsonRecord(current);
            const currentSequence = Number(decoded?.seq);
            if (Number.isFinite(currentSequence) && currentSequence >= Number(sequence)) {
              return Promise.resolve(0);
            }
          }
          store.set(key, payload);
          return Promise.resolve(1);
        }
      }
      default: {
        return () => null;
      }
    }
  }

  const instance: Redis = Object.create(Redis.prototype);

  const isRedisMethod = (property: string | symbol): property is keyof Redis =>
    property in Redis.prototype;

  const NoopRedis = new Proxy(instance, {
    get(target, property, receiver) {
      if (Object.hasOwn(target, property)) {
        return Reflect.get(target, property, receiver);
      }

      if (isRedisMethod(property)) {
        const value = target[property];
        if (typeof value === "function") {
          return stub(property);
        }
        return Reflect.get(target, property, receiver);
      }

      return Reflect.get(target, property, receiver);
    }
  })

  return NoopRedis;
};

const ignoredCallbacks: unknown[] = [];

const ignoreBroadcast = (userId: string, eventName: string, data: unknown): void => {
  ignoredCallbacks.push({ data, eventName, userId });
};

const ignorePersistSyncStatus = (result: DestinationSyncResult, syncedAt: Date): Promise<void> => {
  ignoredCallbacks.push({ result, syncedAt });
  return Promise.resolve();
};

const ignoreOnError = (scope: string, error: Error): void => {
  ignoredCallbacks.push({ error, scope });
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const createRuntimeConfig = (
  overrides: Partial<SyncAggregateRuntimeConfig> = {},
): SyncAggregateRuntimeConfig => ({
  broadcast: ignoreBroadcast,
  onError: ignoreOnError,
  persistSyncStatus: ignorePersistSyncStatus,
  redis: createMockRedis(),
  tracker: new SyncAggregateTracker({ progressThrottleMs: 0 }),
  ...overrides,
});

const createProgressUpdate = (
  overrides: Partial<SyncProgressUpdate> = {},
): SyncProgressUpdate => ({
  calendarId: "cal-1",
  inSync: false,
  localEventCount: 0,
  remoteEventCount: 0,
  stage: "fetching",
  status: "syncing",
  userId: "user-1",
  ...overrides,
});

const createDestinationResult = (
  overrides: Partial<DestinationSyncResult> = {},
): DestinationSyncResult => ({
  calendarId: "cal-1",
  localEventCount: 5,
  remoteEventCount: 5,
  userId: "user-1",
  ...overrides,
});

describe("createSyncAggregateRuntime", () => {
  describe("onSyncProgress", () => {
    it("broadcasts aggregate when tracker emits a message", async () => {
      const broadcasts: { userId: string; event: string; data: unknown }[] = [];

      const runtime = createSyncAggregateRuntime(createRuntimeConfig({
        broadcast: (userId, event, data) => broadcasts.push({ data, event, userId }),
      }));

      runtime.onSyncProgress(
        createProgressUpdate({ progress: { current: 0, total: 10 } }),
      );

      await flushAsync();

      expect(broadcasts.length).toBeGreaterThanOrEqual(1);
      const [firstBroadcast] = broadcasts;
      expect(firstBroadcast).toBeDefined();
      if (!firstBroadcast) {
        throw new TypeError("Expected first broadcast");
      }
      expect(firstBroadcast.event).toBe("sync:aggregate");
      expect(firstBroadcast.userId).toBe("user-1");
    });
  });

  describe("onDestinationSync", () => {
    it("persists sync status and broadcasts result", async () => {
      const broadcasts: { userId: string; event: string; data: unknown }[] = [];
      const persisted: { result: DestinationSyncResult; syncedAt: Date }[] = [];
      const tracker = new SyncAggregateTracker({ progressThrottleMs: 0 });

      const runtime = createSyncAggregateRuntime(createRuntimeConfig({
        broadcast: (userId, event, data) => broadcasts.push({ data, event, userId }),
        persistSyncStatus: (result, syncedAt) => {
          persisted.push({ result, syncedAt });
          return Promise.resolve();
        },
        tracker,
      }));

      tracker.trackProgress(
        createProgressUpdate({ calendarId: "cal-1", progress: { current: 5, total: 10 } }),
      );

      await runtime.onDestinationSync(createDestinationResult());

      expect(persisted).toHaveLength(1);
      const [firstPersisted] = persisted;
      expect(firstPersisted).toBeDefined();
      if (!firstPersisted) {
        throw new TypeError("Expected persisted sync status");
      }
      expect(firstPersisted.result.calendarId).toBe("cal-1");
      expect(broadcasts.length).toBeGreaterThanOrEqual(1);
    });

    it("skips broadcast when result.broadcast is false", async () => {
      const broadcasts: unknown[] = [];
      const persisted: unknown[] = [];

      const runtime = createSyncAggregateRuntime(createRuntimeConfig({
        broadcast: (userId, eventName, data) => {
          broadcasts.push({ data, eventName, userId });
        },
        persistSyncStatus: () => {
          persisted.push(true);
          return Promise.resolve();
        },
      }));

      await runtime.onDestinationSync(
        createDestinationResult({ broadcast: false }),
      );

      expect(broadcasts).toHaveLength(0);
      expect(persisted).toHaveLength(0);
    });

    it("finalizes and broadcasts completion even when persistence fails", async () => {
      const broadcasts: { data: unknown }[] = [];
      const tracker = new SyncAggregateTracker({ progressThrottleMs: 0 });

      const runtime = createSyncAggregateRuntime(createRuntimeConfig({
        broadcast: (_userId, _eventName, data) => {
          broadcasts.push({ data });
        },
        persistSyncStatus: () => Promise.reject(new Error("database down")),
        tracker,
      }));

      tracker.trackProgress(
        createProgressUpdate({ calendarId: "cal-1", progress: { current: 5, total: 10 } }),
      );

      await expect(
        runtime.onDestinationSync(createDestinationResult()),
      ).rejects.toThrow("database down");

      expect(broadcasts.length).toBeGreaterThanOrEqual(1);
      const lastBroadcast = broadcasts.at(-1);
      expect(lastBroadcast).toBeDefined();
      if (!lastBroadcast || !isRecord(lastBroadcast.data)) {
        throw new TypeError("Expected broadcast data object");
      }
      expect(lastBroadcast.data.syncing).toBe(false);
      expect(lastBroadcast.data.syncEventsRemaining).toBe(0);
    });
  });

  describe("beginSyncRun", () => {
    it("clears accumulated progress from previous runs", () => {
      const tracker = new SyncAggregateTracker({ progressThrottleMs: 0 });
      const runtime = createSyncAggregateRuntime(createRuntimeConfig({ tracker }));

      tracker.trackProgress(
        createProgressUpdate({ progress: { current: 176, total: 3689 } }),
      );

      runtime.beginSyncRun("user-1");

      const aggregate = runtime.getCurrentSyncAggregate("user-1");
      expect(aggregate.syncEventsTotal).toBe(0);
      expect(aggregate.syncEventsProcessed).toBe(0);
      expect(aggregate.syncing).toBe(false);
      expect(aggregate.progressPercent).toBe(100);
    });
  });

  describe("getCurrentSyncAggregate", () => {
    it("delegates to tracker and returns current state", () => {
      const runtime = createSyncAggregateRuntime(createRuntimeConfig());

      const result = runtime.getCurrentSyncAggregate("user-1");

      expect(result.syncing).toBe(false);
      expect(result.progressPercent).toBe(100);
    });

    it("passes fallback to tracker", () => {
      const runtime = createSyncAggregateRuntime(createRuntimeConfig());

      const result = runtime.getCurrentSyncAggregate("user-1", {
        progressPercent: 42,
        syncEventsProcessed: 0,
        syncEventsRemaining: 0,
        syncEventsTotal: 0,
      });

      expect(result.progressPercent).toBe(42);
    });
  });

  describe("getCachedSyncAggregate", () => {
    it("returns null when no cached value exists", async () => {
      const runtime = createSyncAggregateRuntime(createRuntimeConfig());

      const result = await runtime.getCachedSyncAggregate("user-1");
      expect(result).toBeNull();
    });

    it("returns parsed cached aggregate when valid", async () => {
      const redis = createMockRedis();
      const cached = {
        progressPercent: 100,
        seq: 3,
        syncEventsProcessed: 10,
        syncEventsRemaining: 0,
        syncEventsTotal: 10,
        syncing: false,
      };
      redis.set("sync:aggregate:latest:user-1", JSON.stringify(cached));

      const runtime = createSyncAggregateRuntime(createRuntimeConfig({ redis }));

      const result = await runtime.getCachedSyncAggregate("user-1");
      expect(result).toEqual(cached);
    });

    it("returns null for invalid cached JSON", async () => {
      const redis = createMockRedis();
      redis.set("sync:aggregate:latest:user-1", "not-valid-json");

      const runtime = createSyncAggregateRuntime(createRuntimeConfig({ redis }));

      const result = await runtime.getCachedSyncAggregate("user-1");
      expect(result).toBeNull();
    });

    it("returns null for valid JSON that doesn't match aggregate shape", async () => {
      const redis = createMockRedis();
      redis.set(
        "sync:aggregate:latest:user-1",
        JSON.stringify({ foo: "bar" }),
      );

      const runtime = createSyncAggregateRuntime(createRuntimeConfig({ redis }));

      const result = await runtime.getCachedSyncAggregate("user-1");
      expect(result).toBeNull();
    });

    it("accepts cached aggregate with lastSyncedAt field", async () => {
      const redis = createMockRedis();
      const cached = {
        lastSyncedAt: "2026-03-08T12:00:00.000Z",
        progressPercent: 100,
        seq: 1,
        syncEventsProcessed: 5,
        syncEventsRemaining: 0,
        syncEventsTotal: 5,
        syncing: false,
      };

      redis.set("sync:aggregate:latest:user-1", JSON.stringify(cached));

      const runtime = createSyncAggregateRuntime(createRuntimeConfig({ redis }));

      const result = await runtime.getCachedSyncAggregate("user-1");
      expect(result).toEqual(cached);
    });

    it("returns fresh syncing aggregate with recent emittedAt", async () => {
      const redis = createMockRedis();
      const cached = {
        emittedAt: new Date().toISOString(),
        progressPercent: 40,
        seq: 5,
        syncEventsProcessed: 4,
        syncEventsRemaining: 6,
        syncEventsTotal: 10,
        syncing: true,
      };
      redis.set("sync:aggregate:latest:user-1", JSON.stringify(cached));

      const runtime = createSyncAggregateRuntime(createRuntimeConfig({ redis }));

      const result = await runtime.getCachedSyncAggregate("user-1");
      expect(result).toEqual(cached);
    });

    it("returns null for a syncing aggregate whose emittedAt is stale", async () => {
      const redis = createMockRedis();
      const staleEmittedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const cached = {
        emittedAt: staleEmittedAt,
        progressPercent: 4.77,
        seq: 75_370,
        syncEventsProcessed: 176,
        syncEventsRemaining: 3513,
        syncEventsTotal: 3689,
        syncing: true,
      };
      redis.set("sync:aggregate:latest:user-1", JSON.stringify(cached));

      const runtime = createSyncAggregateRuntime(createRuntimeConfig({ redis }));

      const result = await runtime.getCachedSyncAggregate("user-1");
      expect(result).toBeNull();
    });

    it("returns null for a syncing aggregate without emittedAt", async () => {
      const redis = createMockRedis();
      const cached = {
        progressPercent: 40,
        seq: 5,
        syncEventsProcessed: 4,
        syncEventsRemaining: 6,
        syncEventsTotal: 10,
        syncing: true,
      };
      redis.set("sync:aggregate:latest:user-1", JSON.stringify(cached));

      const runtime = createSyncAggregateRuntime(createRuntimeConfig({ redis }));

      const result = await runtime.getCachedSyncAggregate("user-1");
      expect(result).toBeNull();
    });

    it("returns idle aggregate regardless of age", async () => {
      const redis = createMockRedis();
      const staleEmittedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const cached = {
        emittedAt: staleEmittedAt,
        progressPercent: 100,
        seq: 5,
        syncEventsProcessed: 10,
        syncEventsRemaining: 0,
        syncEventsTotal: 10,
        syncing: false,
      };
      redis.set("sync:aggregate:latest:user-1", JSON.stringify(cached));

      const runtime = createSyncAggregateRuntime(createRuntimeConfig({ redis }));

      const result = await runtime.getCachedSyncAggregate("user-1");
      expect(result).toEqual(cached);
    });
  });

  describe("emitSyncAggregate", () => {
    it("stores idle aggregate in redis and broadcasts with redis sequence", async () => {
      const redis = createMockRedis();
      const broadcasts: { data: unknown; eventName: string; userId: string }[] = [];

      const runtime = createSyncAggregateRuntime(createRuntimeConfig({
        broadcast: (userId, eventName, data) => {
          broadcasts.push({ data, eventName, userId });
        },
        redis,
      }));

      await runtime.emitSyncAggregate("user-1", {
        progressPercent: 50,
        seq: 1,
        syncEventsProcessed: 5,
        syncEventsRemaining: 5,
        syncEventsTotal: 10,
        syncing: false,
      });

      expect(broadcasts).toHaveLength(1);
      const [firstBroadcast] = broadcasts;
      expect(firstBroadcast).toBeDefined();
      if (!firstBroadcast) {
        throw new TypeError("Expected first broadcast");
      }
      const { data: broadcastData } = firstBroadcast;
      expect(isRecord(broadcastData)).toBe(true);
      if (!isRecord(broadcastData)) {
        throw new TypeError("Expected broadcast data object");
      }
      expect(broadcastData.seq).toBe(1);
      expect(typeof broadcastData.emittedAt).toBe("string");

      const stored = await redis.get("sync:aggregate:latest:user-1");
      expect(stored).not.toBeNull();
    });

    it("stores syncing aggregate in redis latest cache for fresh reconnects", async () => {
      const redis = createMockRedis();
      const broadcasts: { data: unknown; eventName: string; userId: string }[] = [];

      const runtime = createSyncAggregateRuntime(createRuntimeConfig({
        broadcast: (userId, eventName, data) => {
          broadcasts.push({ data, eventName, userId });
        },
        redis,
      }));

      await runtime.emitSyncAggregate("user-1", {
        progressPercent: 50,
        seq: 1,
        syncEventsProcessed: 5,
        syncEventsRemaining: 5,
        syncEventsTotal: 10,
        syncing: true,
      });

      expect(broadcasts).toHaveLength(1);
      expect(redis.get("sync:aggregate:latest:user-1")).resolves.not.toBeNull();
      expect(redis.get("sync:aggregate:seq:user-1")).resolves.toBe("1");
    });

    it("does not overwrite a cached aggregate with a newer sequence", async () => {
      const redis = createMockRedis();
      const newerCached = {
        emittedAt: new Date().toISOString(),
        progressPercent: 100,
        seq: 10,
        syncEventsProcessed: 10,
        syncEventsRemaining: 0,
        syncEventsTotal: 10,
        syncing: false,
      };
      redis.set("sync:aggregate:latest:user-1", JSON.stringify(newerCached));

      const runtime = createSyncAggregateRuntime(createRuntimeConfig({ redis }));

      await runtime.emitSyncAggregate("user-1", {
        progressPercent: 50,
        seq: 1,
        syncEventsProcessed: 5,
        syncEventsRemaining: 5,
        syncEventsTotal: 10,
        syncing: true,
      });

      const stored = await redis.get("sync:aggregate:latest:user-1");
      expect(stored).not.toBeNull();
      if (!stored) {
        throw new TypeError("Expected stored aggregate");
      }
      expect(JSON.parse(stored)).toEqual(newerCached);
    });

    it("still broadcasts and reports the error if redis fails", async () => {
      const broadcasts: { data: unknown; eventName: string; userId: string }[] = [];
      const reportedErrors: { scope: string; error: Error }[] = [];
      const failingRedis = createMockRedis();
      failingRedis.incr = (() => Promise.reject(new Error("redis down"))) satisfies typeof failingRedis.incr;

      const runtime = createSyncAggregateRuntime(createRuntimeConfig({
        broadcast: (userId, eventName, data) => {
          broadcasts.push({ data, eventName, userId });
        },
        onError: (scope, error) => {
          reportedErrors.push({ error, scope });
        },
        redis: failingRedis,
      }));

      const aggregate = {
        progressPercent: 50,
        seq: 1,
        syncEventsProcessed: 5,
        syncEventsRemaining: 5,
        syncEventsTotal: 10,
        syncing: true,
      };

      await runtime.emitSyncAggregate("user-1", aggregate);

      expect(broadcasts).toHaveLength(1);
      const [firstBroadcast] = broadcasts;
      expect(firstBroadcast).toBeDefined();
      if (!firstBroadcast) {
        throw new TypeError("Expected first broadcast");
      }
      expect(firstBroadcast.data).toEqual(aggregate);

      expect(reportedErrors).toHaveLength(1);
      const [firstError] = reportedErrors;
      expect(firstError).toBeDefined();
      if (!firstError) {
        throw new TypeError("Expected reported error");
      }
      expect(firstError.scope).toBe("emit");
      expect(firstError.error.message).toBe("redis down");
    });
  });
});
