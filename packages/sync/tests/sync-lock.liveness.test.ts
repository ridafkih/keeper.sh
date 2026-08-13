import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BACKGROUND_HOLDER_PREFIX,
  createSyncLock,
  LOCK_PREFIX,
  LOCK_RENEW_INTERVAL_MS,
  SyncLockRenewalError,
} from "../src/sync-lock";

/*
 * `createLockHandle` records a renewal failure in `renewalState.error` and
 * never clears it. `throwIfRenewalFailed` therefore poisons the handle for the
 * rest of the run: one transient Redis error on a single renewal tick makes
 * every later `isHeld()` / `isCurrent()` throw, even after renewals recover and
 * the lock is demonstrably still held.
 *
 * This test is RED against the current implementation.
 */

const createMockRedis = () => {
  const store = new Map<string, string>();
  const lists = new Map<string, string[]>();
  const pendingFailures: Error[] = [];

  const acquireOrSignal = (args: string[]): Promise<unknown> => {
    {
      const [lockKey = "", signalKey = "", , waiterKey = "", holderId = ""] = args;
      const waiters = (lists.get(waiterKey) ?? []).filter((item) => item !== holderId);
      waiters.unshift(holderId);
      lists.set(waiterKey, waiters);
      const hadSignal = store.has(signalKey);
      store.set(signalKey, holderId);
      if (!store.has(lockKey)) {
        store.set(lockKey, holderId);
        return Promise.resolve("acquired");
      }
      if (hadSignal) {
        return Promise.resolve("replaced");
      }
      return Promise.resolve("queued");
    }

  };

  const confirmAcquisition = (args: string[]): Promise<unknown> => {
    {
      const [lockKey = "", signalKey = "", waiterKey = "", holderId = ""] = args;
      const [head] = lists.get(waiterKey) ?? [];
      if (store.get(lockKey) !== holderId || store.get(signalKey) !== holderId || head !== holderId) {
        return Promise.resolve(0);
      }
      store.delete(signalKey);
      lists.delete(waiterKey);
      return Promise.resolve(1);
    }

  };

  const renewLock = (args: string[]): Promise<unknown> => {
    const [lockKey = "", holderId = ""] = args;
    if (store.get(lockKey) === holderId) {
      return Promise.resolve(1);
    }
    return Promise.resolve(0);
  };

  const releaseLock = (args: string[]): Promise<unknown> => {
    const [lockKey = "", holderId = ""] = args;
    if (store.get(lockKey) === holderId) {
      store.delete(lockKey);
      return Promise.resolve(1);
    }
    return Promise.resolve(0);
  };

  const isCurrent = (args: string[]): Promise<unknown> => {
    const [lockKey = "", waiterKey = "", holderId = ""] = args;
    if (store.get(lockKey) !== holderId) {
      return Promise.resolve(0);
    }
    const waiters = lists.get(waiterKey) ?? [];
    const preempted = waiters.some((waiter) =>
      waiter !== holderId && !waiter.startsWith(BACKGROUND_HOLDER_PREFIX));
    if (preempted) {
      return Promise.resolve(0);
    }
    return Promise.resolve(1);
  };

  const evalImpl = (
    script: string,
    keyCount: number,
    ...args: string[]
  ): Promise<unknown> => {
    const failure = pendingFailures.shift();
    if (failure) {
      return Promise.reject(failure);
    }
    if (script.includes("LRANGE")) {
      return isCurrent(args);
    }
    if (keyCount === 4) {
      return acquireOrSignal(args);
    }
    if (keyCount === 3) {
      return confirmAcquisition(args);
    }
    if (args.length === 3) {
      return renewLock(args);
    }
    if (args.length === 2) {
      return releaseLock(args);
    }
    return Promise.reject(new Error(`unexpected EVAL: ${keyCount} keys, ${args.length} args`));
  };

  return {
    eval: evalImpl,
    get: (key: string) => Promise.resolve(store.get(key) ?? null),
    rejectNextEval: (error: Error) => {
      pendingFailures.push(error);
    },
    rawGet: (key: string) => store.get(key) ?? null,
  };
};

describe("sync lock renewal recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("recovers the handle after a transient renewal failure is followed by a success", async () => {
    const redis = createMockRedis();
    const syncLock = createSyncLock(redis);

    const result = await syncLock.acquire("calendar-1");
    expect(result.acquired).toBe(true);
    if (!result.acquired) {
      return;
    }

    // One transient blip on the first renewal tick.
    redis.rejectNextEval(new Error("ETIMEDOUT"));
    await vi.advanceTimersByTimeAsync(LOCK_RENEW_INTERVAL_MS);

    // Two subsequent ticks succeed, so the lock is provably still ours.
    await vi.advanceTimersByTimeAsync(LOCK_RENEW_INTERVAL_MS * 2);
    expect(redis.rawGet(`${LOCK_PREFIX}calendar-1`)).not.toBeNull();

    // The handle should be usable again, but the poisoned flag is never cleared.
    await expect(result.handle.isHeld()).resolves.toBe(true);
    await expect(result.handle.isCurrent()).resolves.toBe(true);

    await result.handle.release();
  });

  it("does not treat a single renewal blip as terminal for the whole run", async () => {
    const redis = createMockRedis();
    const syncLock = createSyncLock(redis);
    const result = await syncLock.acquire("calendar-2");
    if (!result.acquired) {
      throw new Error("expected acquire");
    }

    redis.rejectNextEval(new Error("ETIMEDOUT"));
    await vi.advanceTimersByTimeAsync(LOCK_RENEW_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(LOCK_RENEW_INTERVAL_MS);

    let thrown: unknown = null;
    try {
      await result.handle.isCurrent();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).not.toBeInstanceOf(SyncLockRenewalError);

    await result.handle.release();
  });
});
