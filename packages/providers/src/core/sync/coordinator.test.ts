import { describe, expect, it } from "bun:test";
import { createSyncCoordinator } from "./coordinator";
import type { DestinationSyncResult, SyncProgressUpdate } from "./coordinator";

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
  };
};

describe("createSyncCoordinator", () => {
  describe("startSync", () => {
    it("returns a context with generation 1 on first sync", async () => {
      const redis = createMockRedis();
      const coordinator = createSyncCoordinator({ redis: redis as never });

      const context = await coordinator.startSync("user-1");

      expect(context.generation).toBe(1);
      expect(context.userId).toBe("user-1");
    });

    it("increments generation on subsequent syncs", async () => {
      const redis = createMockRedis();
      const coordinator = createSyncCoordinator({ redis: redis as never });

      const first = await coordinator.startSync("user-1");
      const second = await coordinator.startSync("user-1");

      expect(first.generation).toBe(1);
      expect(second.generation).toBe(2);
    });

    it("tracks generations independently per user", async () => {
      const redis = createMockRedis();
      const coordinator = createSyncCoordinator({ redis: redis as never });

      const user1 = await coordinator.startSync("user-1");
      const user2 = await coordinator.startSync("user-2");

      expect(user1.generation).toBe(1);
      expect(user2.generation).toBe(1);
    });

    it("passes onDestinationSync callback through to context", async () => {
      const redis = createMockRedis();
      const destinationSyncCalls: string[] = [];
      const onDestinationSync = (result: DestinationSyncResult): Promise<void> => {
        destinationSyncCalls.push(result.userId);
        return Promise.resolve();
      };
      const coordinator = createSyncCoordinator({
        onDestinationSync,
        redis: redis as never,
      });

      const context = await coordinator.startSync("user-1");
      expect(context.onDestinationSync).toBe(onDestinationSync);
    });

    it("passes onSyncProgress callback through to context", async () => {
      const redis = createMockRedis();
      const progressCalls: string[] = [];
      const onSyncProgress = (update: SyncProgressUpdate): void => {
        progressCalls.push(update.userId);
      };
      const coordinator = createSyncCoordinator({
        onSyncProgress,
        redis: redis as never,
      });

      const context = await coordinator.startSync("user-1");
      expect(context.onSyncProgress).toBe(onSyncProgress);
    });
  });

  describe("isCurrent", () => {
    it("returns true when no newer sync has started", async () => {
      const redis = createMockRedis();
      const coordinator = createSyncCoordinator({ redis: redis as never });

      const context = await coordinator.startSync("user-1");
      const current = await context.isCurrent();

      expect(current).toBe(true);
    });

    it("returns false when a newer sync has started", async () => {
      const redis = createMockRedis();
      const coordinator = createSyncCoordinator({ redis: redis as never });

      const first = await coordinator.startSync("user-1");
      await coordinator.startSync("user-1");

      const current = await first.isCurrent();

      expect(current).toBe(false);
    });

    it("returns false when the key has been deleted", async () => {
      const redis = createMockRedis();
      const coordinator = createSyncCoordinator({ redis: redis as never });

      const context = await coordinator.startSync("user-1");
      redis.store.clear();

      const current = await context.isCurrent();

      expect(current).toBe(false);
    });
  });

  describe("isSyncCurrent", () => {
    it("delegates to context.isCurrent", async () => {
      const redis = createMockRedis();
      const coordinator = createSyncCoordinator({ redis: redis as never });

      const context = await coordinator.startSync("user-1");
      const result = await coordinator.isSyncCurrent(context);

      expect(result).toBe(true);
    });
  });
});
