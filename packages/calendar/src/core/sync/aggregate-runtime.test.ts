import { describe, expect, it } from "bun:test";
import { createSyncAggregateRuntime } from "./aggregate-runtime";
import { SyncAggregateTracker } from "./aggregate-tracker";
import type { DestinationSyncResult, SyncProgressUpdate } from "./types";

const sleep = (milliseconds: number): Promise<void> => Bun.sleep(milliseconds);

const createMockRedis = () => {
  const store = new Map<string, string>();

  return {
    store,
    incr: (key: string): Promise<number> => {
      const current = Number.parseInt(store.get(key) ?? "0", 10);
      const next = current + 1;
      store.set(key, String(next));
      return Promise.resolve(next);
    },
    expire: (_key: string, _seconds: number): Promise<number> => Promise.resolve(1),
    get: (key: string): Promise<string | null> => Promise.resolve(store.get(key) ?? null),
    set: (key: string, value: string): Promise<void> => {
      store.set(key, value);
      return Promise.resolve();
    },
  };
};

const ignoredCallbacks: unknown[] = [];

const ignoreBroadcast = (userId: string, eventName: string, data: unknown): void => {
  ignoredCallbacks.push({ data, eventName, userId });
};

const ignorePersistSyncStatus = (result: DestinationSyncResult, syncedAt: Date): Promise<void> => {
  ignoredCallbacks.push({ result, syncedAt });
  return Promise.resolve();
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

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
      const redis = createMockRedis();
      const broadcasts: { userId: string; event: string; data: unknown }[] = [];

      const runtime = createSyncAggregateRuntime({
        broadcast: (userId, event, data) => broadcasts.push({ data, event, userId }),
        persistSyncStatus: ignorePersistSyncStatus,
        redis: redis as never,
        tracker: new SyncAggregateTracker({ progressThrottleMs: 0 }),
      });

      runtime.onSyncProgress(
        createProgressUpdate({ progress: { current: 0, total: 10 } }),
      );

      await sleep(50);

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
      const redis = createMockRedis();
      const broadcasts: { userId: string; event: string; data: unknown }[] = [];
      const persisted: { result: DestinationSyncResult; syncedAt: Date }[] = [];
      const tracker = new SyncAggregateTracker({ progressThrottleMs: 0 });

      const runtime = createSyncAggregateRuntime({
        broadcast: (userId, event, data) => broadcasts.push({ data, event, userId }),
        persistSyncStatus: (result, syncedAt) => {
          persisted.push({ result, syncedAt });
          return Promise.resolve();
        },
        redis: redis as never,
        tracker,
      });

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
      const redis = createMockRedis();
      const broadcasts: unknown[] = [];
      const persisted: unknown[] = [];

      const runtime = createSyncAggregateRuntime({
        broadcast: (userId, eventName, data) => {
          broadcasts.push({ data, eventName, userId });
        },
        persistSyncStatus: () => {
          persisted.push(true);
          return Promise.resolve();
        },
        redis: redis as never,
        tracker: new SyncAggregateTracker({ progressThrottleMs: 0 }),
      });

      await runtime.onDestinationSync(
        createDestinationResult({ broadcast: false }),
      );

      expect(broadcasts).toHaveLength(0);
      expect(persisted).toHaveLength(0);
    });
  });

  describe("getCurrentSyncAggregate", () => {
    it("delegates to tracker and returns current state", () => {
      const redis = createMockRedis();
      const tracker = new SyncAggregateTracker({ progressThrottleMs: 0 });

      const runtime = createSyncAggregateRuntime({
        broadcast: ignoreBroadcast,
        persistSyncStatus: ignorePersistSyncStatus,
        redis: redis as never,
        tracker,
      });

      const result = runtime.getCurrentSyncAggregate("user-1");

      expect(result.syncing).toBe(false);
      expect(result.progressPercent).toBe(100);
    });

    it("passes fallback to tracker", () => {
      const redis = createMockRedis();
      const tracker = new SyncAggregateTracker({ progressThrottleMs: 0 });

      const runtime = createSyncAggregateRuntime({
        broadcast: ignoreBroadcast,
        persistSyncStatus: ignorePersistSyncStatus,
        redis: redis as never,
        tracker,
      });

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
      const redis = createMockRedis();
      const runtime = createSyncAggregateRuntime({
        broadcast: ignoreBroadcast,
        persistSyncStatus: ignorePersistSyncStatus,
        redis: redis as never,
      });

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
      redis.store.set("sync:aggregate:latest:user-1", JSON.stringify(cached));

      const runtime = createSyncAggregateRuntime({
        broadcast: ignoreBroadcast,
        persistSyncStatus: ignorePersistSyncStatus,
        redis: redis as never,
      });

      const result = await runtime.getCachedSyncAggregate("user-1");
      expect(result).toEqual(cached);
    });

    it("returns null for invalid cached JSON", async () => {
      const redis = createMockRedis();
      redis.store.set("sync:aggregate:latest:user-1", "not-valid-json");

      const runtime = createSyncAggregateRuntime({
        broadcast: ignoreBroadcast,
        persistSyncStatus: ignorePersistSyncStatus,
        redis: redis as never,
      });

      const result = await runtime.getCachedSyncAggregate("user-1");
      expect(result).toBeNull();
    });

    it("returns null for valid JSON that doesn't match aggregate shape", async () => {
      const redis = createMockRedis();
      redis.store.set(
        "sync:aggregate:latest:user-1",
        JSON.stringify({ foo: "bar" }),
      );

      const runtime = createSyncAggregateRuntime({
        broadcast: ignoreBroadcast,
        persistSyncStatus: ignorePersistSyncStatus,
        redis: redis as never,
      });

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
      redis.store.set("sync:aggregate:latest:user-1", JSON.stringify(cached));

      const runtime = createSyncAggregateRuntime({
        broadcast: ignoreBroadcast,
        persistSyncStatus: ignorePersistSyncStatus,
        redis: redis as never,
      });

      const result = await runtime.getCachedSyncAggregate("user-1");
      expect(result).toEqual(cached);
    });
  });

  describe("emitSyncAggregate", () => {
    it("stores idle aggregate in redis and broadcasts with redis sequence", async () => {
      const redis = createMockRedis();
      const broadcasts: { data: unknown; eventName: string; userId: string }[] = [];

      const runtime = createSyncAggregateRuntime({
        broadcast: (userId, eventName, data) => {
          broadcasts.push({ data, eventName, userId });
        },
        persistSyncStatus: ignorePersistSyncStatus,
        redis: redis as never,
      });

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

      const stored = redis.store.get("sync:aggregate:latest:user-1");
      expect(stored).toBeDefined();
    });

    it("stores syncing aggregate in redis latest cache for fresh reconnects", async () => {
      const redis = createMockRedis();
      const broadcasts: { data: unknown; eventName: string; userId: string }[] = [];

      const runtime = createSyncAggregateRuntime({
        broadcast: (userId, eventName, data) => {
          broadcasts.push({ data, eventName, userId });
        },
        persistSyncStatus: ignorePersistSyncStatus,
        redis: redis as never,
      });

      await runtime.emitSyncAggregate("user-1", {
        progressPercent: 50,
        seq: 1,
        syncEventsProcessed: 5,
        syncEventsRemaining: 5,
        syncEventsTotal: 10,
        syncing: true,
      });

      expect(broadcasts).toHaveLength(1);
      expect(redis.store.get("sync:aggregate:latest:user-1")).toBeDefined();
      expect(redis.store.get("sync:aggregate:seq:user-1")).toBe("1");
    });

    it("still broadcasts even if redis fails", async () => {
      const broadcasts: { data: unknown; eventName: string; userId: string }[] = [];
      const failingRedis = {
        incr: (): Promise<number> => Promise.reject(new Error("redis down")),
        expire: (): Promise<number> => Promise.resolve(1),
        get: (): Promise<string | null> => Promise.resolve(null),
        set: (): Promise<void> => Promise.resolve(),
      };

      const runtime = createSyncAggregateRuntime({
        broadcast: (userId, eventName, data) => {
          broadcasts.push({ data, eventName, userId });
        },
        persistSyncStatus: ignorePersistSyncStatus,
        redis: failingRedis as never,
      });

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
    });
  });
});
