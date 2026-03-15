import { describe, expect, it } from "bun:test";
import { createSyncLock, LOCK_PREFIX, SIGNAL_PREFIX } from "./sync-lock";

const createMockRedis = () => {
  const store = new Map<string, { value: string; expiresAt: number | null }>();

  const isExpired = (key: string): boolean => {
    const entry = store.get(key);
    if (!entry) {
      return true;
    }
    if (entry.expiresAt !== null && Date.now() >= entry.expiresAt) {
      store.delete(key);
      return true;
    }
    return false;
  };

  const get = (key: string): Promise<string | null> => {
    if (isExpired(key)) {
      return Promise.resolve(null);
    }
    return Promise.resolve(store.get(key)?.value ?? null);
  };

  const set = (
    key: string,
    value: string,
    _exMode?: string,
    exValue?: number,
  ): void => {
    let expiresAt: number | null = null;
    if (exValue) {
      expiresAt = Date.now() + exValue * 1000;
    }
    store.set(key, { value, expiresAt });
  };

  const del = (key: string): void => {
    store.delete(key);
  };

  const readValue = (key: string): string | null => {
    if (isExpired(key)) {
      return null;
    }
    return store.get(key)?.value ?? null;
  };

  const evalImpl = (
    script: string,
    _keyCount: number,
    ...args: string[]
  ): Promise<unknown> => {
    const lockKey = args[0] ?? "";

    // ACQUIRE_OR_SIGNAL_SCRIPT (has two keys)
    if (script.includes("KEYS[2]") && script.includes("return 'acquired'")) {
      const signalKey = args[1] ?? "";
      const holderId = args[2] ?? "";
      const ttlSeconds = Number(args[3]);

      const lockValue = readValue(lockKey);
      if (lockValue === null) {
        set(lockKey, holderId, "EX", ttlSeconds);
        del(signalKey);
        return Promise.resolve("acquired");
      }

      const existing = readValue(signalKey);
      set(signalKey, holderId, "EX", ttlSeconds);

      if (existing !== null) {
        return Promise.resolve("replaced");
      }
      return Promise.resolve("queued");
    }

    // RELEASE_SCRIPT (has one key)
    const holderId = args[1] ?? "";
    const holder = readValue(lockKey);
    if (holder === holderId) {
      del(lockKey);
      return Promise.resolve(1);
    }
    return Promise.resolve(0);
  };

  return { get, set, del, eval: evalImpl };
};

describe("createSyncLock", () => {
  const makeSyncLock = () => {
    const redis = createMockRedis();
    const syncLock = createSyncLock(redis);
    return { redis, syncLock };
  };

  it("acquires the lock immediately when no one holds it", async () => {
    const { syncLock } = makeSyncLock();

    const result = await syncLock.acquire("cal-1");

    expect(result.acquired).toBe(true);
  });

  it("sets the lock key in Redis when acquired", async () => {
    const { redis, syncLock } = makeSyncLock();

    await syncLock.acquire("cal-1");

    const lockValue = await redis.get(`${LOCK_PREFIX}cal-1`);
    expect(lockValue).not.toBeNull();
  });

  it("clears any stale signal key when acquiring a free lock", async () => {
    const { redis, syncLock } = makeSyncLock();

    redis.set(`${SIGNAL_PREFIX}cal-1`, "old-waiter");

    await syncLock.acquire("cal-1");

    const signalValue = await redis.get(`${SIGNAL_PREFIX}cal-1`);
    expect(signalValue).toBeNull();
  });

  describe("isCurrent", () => {
    it("returns true when no one is waiting", async () => {
      const { syncLock } = makeSyncLock();
      const result = await syncLock.acquire("cal-1");

      if (!result.acquired) {
        throw new Error("expected acquired");
      }

      const current = await result.handle.isCurrent();
      expect(current).toBe(true);
    });

    it("returns false when a waiter signals", async () => {
      const { redis, syncLock } = makeSyncLock();
      const firstResult = await syncLock.acquire("cal-1");

      if (!firstResult.acquired) {
        throw new Error("expected acquired");
      }

      // Simulate a second caller setting the signal key
      redis.set(`${SIGNAL_PREFIX}cal-1`, "waiter-id");

      const current = await firstResult.handle.isCurrent();
      expect(current).toBe(false);
    });
  });

  describe("release", () => {
    it("removes the lock key from Redis", async () => {
      const { redis, syncLock } = makeSyncLock();
      const result = await syncLock.acquire("cal-1");

      if (!result.acquired) {
        throw new Error("expected acquired");
      }

      await result.handle.release();

      const lockValue = await redis.get(`${LOCK_PREFIX}cal-1`);
      expect(lockValue).toBeNull();
    });

    it("does not remove the lock if another holder took over", async () => {
      const { redis, syncLock } = makeSyncLock();
      const result = await syncLock.acquire("cal-1");

      if (!result.acquired) {
        throw new Error("expected acquired");
      }

      // Simulate another holder taking over
      redis.set(`${LOCK_PREFIX}cal-1`, "different-holder");

      await result.handle.release();

      const lockValue = await redis.get(`${LOCK_PREFIX}cal-1`);
      expect(lockValue).toBe("different-holder");
    });
  });

  describe("waiter behavior", () => {
    it("second caller sets the signal key and waits then acquires after release", async () => {
      const { redis, syncLock } = makeSyncLock();

      const firstResult = await syncLock.acquire("cal-1");
      if (!firstResult.acquired) {
        throw new Error("expected acquired");
      }

      // Start second acquire — it will poll
      const secondPromise = syncLock.acquire("cal-1");

      // Let the poller run once
      await Bun.sleep(50);

      // Signal key should be set
      const signalValue = await redis.get(`${SIGNAL_PREFIX}cal-1`);
      expect(signalValue).not.toBeNull();

      // First holder sees it is no longer current
      const current = await firstResult.handle.isCurrent();
      expect(current).toBe(false);

      // Release the lock so the waiter can acquire
      await firstResult.handle.release();

      const secondResult = await secondPromise;
      expect(secondResult.acquired).toBe(true);
    });

    it("third caller replaces the second waiter", async () => {
      const { redis, syncLock } = makeSyncLock();

      const firstResult = await syncLock.acquire("cal-1");
      if (!firstResult.acquired) {
        throw new Error("expected acquired");
      }

      // Start second caller — will wait
      const secondPromise = syncLock.acquire("cal-1");
      await Bun.sleep(50);

      const secondSignal = await redis.get(`${SIGNAL_PREFIX}cal-1`);

      // Start third caller — should replace second
      const thirdPromise = syncLock.acquire("cal-1");
      await Bun.sleep(50);

      const thirdSignal = await redis.get(`${SIGNAL_PREFIX}cal-1`);
      expect(thirdSignal).not.toBe(secondSignal);

      // Second should detect it was replaced and return acquired: false
      const secondResult = await secondPromise;
      expect(secondResult.acquired).toBe(false);

      // Release lock so third can acquire
      await firstResult.handle.release();

      const thirdResult = await thirdPromise;
      expect(thirdResult.acquired).toBe(true);
    });

    it("waiter returns acquired false when abort signal is triggered", async () => {
      const { syncLock } = makeSyncLock();

      const firstResult = await syncLock.acquire("cal-1");
      if (!firstResult.acquired) {
        throw new Error("expected acquired");
      }

      const abortController = new AbortController();

      const secondPromise = syncLock.acquire("cal-1", abortController.signal);
      await Bun.sleep(50);

      abortController.abort();

      const secondResult = await secondPromise;
      expect(secondResult.acquired).toBe(false);

      await firstResult.handle.release();
    });
  });

  describe("different calendars", () => {
    it("locks are independent per calendar", async () => {
      const { syncLock } = makeSyncLock();

      const resultA = await syncLock.acquire("cal-1");
      const resultB = await syncLock.acquire("cal-2");

      expect(resultA.acquired).toBe(true);
      expect(resultB.acquired).toBe(true);
    });

    it("signaling one calendar does not affect another", async () => {
      const { redis, syncLock } = makeSyncLock();

      const resultA = await syncLock.acquire("cal-1");
      if (!resultA.acquired) {
        throw new Error("expected acquired");
      }

      // Signal only cal-1
      redis.set(`${SIGNAL_PREFIX}cal-1`, "waiter");

      // Cal-1 should be superseded
      expect(await resultA.handle.isCurrent()).toBe(false);

      // Cal-2 should be unaffected
      const resultB = await syncLock.acquire("cal-2");
      if (!resultB.acquired) {
        throw new Error("expected acquired");
      }
      expect(await resultB.handle.isCurrent()).toBe(true);
    });
  });

  describe("full sync lifecycle", () => {
    it("simulates toggle-toggle-toggle: first finishes, second is replaced, third runs", async () => {
      const { syncLock } = makeSyncLock();
      const executionOrder: string[] = [];

      // Toggle 1: acquires immediately
      const first = await syncLock.acquire("cal-1");
      if (!first.acquired) {
        throw new Error("expected acquired");
      }

      executionOrder.push("first:acquired");

      // Toggle 2: signals first, waits
      const secondPromise = syncLock.acquire("cal-1");
      await Bun.sleep(50);
      executionOrder.push("second:waiting");

      // Toggle 3: replaces second, waits
      const thirdPromise = syncLock.acquire("cal-1");
      await Bun.sleep(50);
      executionOrder.push("third:waiting");

      // Second should be replaced
      const secondResult = await secondPromise;
      expect(secondResult.acquired).toBe(false);
      executionOrder.push("second:replaced");

      // First detects supersession, does its work, flushes, releases
      expect(await first.handle.isCurrent()).toBe(false);
      executionOrder.push("first:superseded");
      executionOrder.push("first:flushed");
      await first.handle.release();
      executionOrder.push("first:released");

      // Third acquires
      const thirdResult = await thirdPromise;
      expect(thirdResult.acquired).toBe(true);
      executionOrder.push("third:acquired");

      if (thirdResult.acquired) {
        // Third runs with fresh state, no one signals it
        expect(await thirdResult.handle.isCurrent()).toBe(true);
        executionOrder.push("third:completed");
        await thirdResult.handle.release();
        executionOrder.push("third:released");
      }

      expect(executionOrder).toEqual([
        "first:acquired",
        "second:waiting",
        "third:waiting",
        "second:replaced",
        "first:superseded",
        "first:flushed",
        "first:released",
        "third:acquired",
        "third:completed",
        "third:released",
      ]);
    });
  });
});
