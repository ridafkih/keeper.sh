import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BACKGROUND_HOLDER_PREFIX,
  createSyncLock,
  LOCK_PREFIX,
  LOCK_RENEW_INTERVAL_MS,
  LOCK_TTL_SECONDS,
  SyncLockRenewalError,
  SIGNAL_PREFIX,
  POLL_INTERVAL_MS,
  WAITER_PREFIX,
} from "../src/sync-lock";

const createMockRedis = () => {
  const store = new Map<string, { value: string; expiresAt: number | null }>();
  const lists = new Map<string, string[]>();
  const evalFailures: Error[] = [];
  let acquireAbortController: AbortController | null = null;
  let deferConfirmation = false;
  let runDeferredConfirmation: (() => void) | null = null;

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

  const runAcquireOrSignal = (args: string[]): unknown => {
    const lockKey = args[0] ?? "";
    const signalKey = args[1] ?? "";
    const blockerLockKey = args[2] ?? "";
    const waiterKey = args[3] ?? "";
    const holderId = args[4] ?? "";
    const lockTtlSeconds = Number(args[5]);
    const signalTtlSeconds = Number(args[6]);
    const checkBlocker = args[7] === "1";

    if (checkBlocker && readValue(blockerLockKey) !== null) {
      return "blocked";
    }

    const existing = readValue(signalKey);
    const waiters = (lists.get(waiterKey) ?? [])
      .filter((waiter) => waiter !== holderId);
    waiters.unshift(holderId);
    lists.set(waiterKey, waiters);
    set(signalKey, holderId, "EX", signalTtlSeconds);

    if (readValue(lockKey) === null) {
      set(lockKey, holderId, "EX", lockTtlSeconds);
      acquireAbortController?.abort();
      acquireAbortController = null;
      return "acquired";
    }

    if (existing === null) {
      return "queued";
    }
    return "replaced";
  };

  const runCancelWaiter = (args: string[]): unknown => {
    const signalKey = args[0] ?? "";
    const waiterKey = args[1] ?? "";
    const lockKey = args[2] ?? "";
    const holderId = args[3] ?? "";
    const signalTtlSeconds = Number(args[4]);
    if (readValue(lockKey) === holderId) {
      del(lockKey);
    }
    const waiters = (lists.get(waiterKey) ?? [])
      .filter((waiter) => waiter !== holderId);
    const [nextWaiter] = waiters;
    if (nextWaiter) {
      lists.set(waiterKey, waiters);
      set(signalKey, nextWaiter, "EX", signalTtlSeconds);
      return nextWaiter;
    }
    lists.delete(waiterKey);
    del(signalKey);
    return "";
  };

  const runConfirmAcquisition = (args: string[]): unknown => {
    const lockKey = args[0] ?? "";
    const signalKey = args[1] ?? "";
    const waiterKey = args[2] ?? "";
    const holderId = args[3] ?? "";
    const [currentWaiter] = lists.get(waiterKey) ?? [];
    if (
      readValue(lockKey) !== holderId
      || readValue(signalKey) !== holderId
      || currentWaiter !== holderId
    ) {
      return 0;
    }
    del(signalKey);
    lists.delete(waiterKey);
    return 1;
  };

  const runIsCurrent = (args: string[]): unknown => {
    const lockKey = args[0] ?? "";
    const waiterKey = args[1] ?? "";
    const invalidationKey = args[2] ?? "";
    const holderId = args[3] ?? "";
    if (readValue(lockKey) !== holderId || readValue(invalidationKey) !== null) {
      return 0;
    }
    const waiters = lists.get(waiterKey) ?? [];
    const preempted = waiters.some((waiter) =>
      waiter !== holderId && !waiter.startsWith(BACKGROUND_HOLDER_PREFIX));
    if (preempted) {
      return 0;
    }
    return 1;
  };

  const runRenew = (args: string[]): unknown => {
    const lockKey = args[0] ?? "";
    const holderId = args[1] ?? "";
    const ttlSeconds = Number(args[2]);
    if (readValue(lockKey) === holderId) {
      set(lockKey, holderId, "EX", ttlSeconds);
      return 1;
    }
    return 0;
  };

  const runRelease = (args: string[]): unknown => {
    const lockKey = args[0] ?? "";
    const holderId = args[1] ?? "";
    if (readValue(lockKey) === holderId) {
      del(lockKey);
      return 1;
    }
    return 0;
  };

  const evalImpl = (
    script: string,
    keyCount: number,
    ...args: string[]
  ): Promise<unknown> => {
    const evalFailure = evalFailures.shift();
    if (evalFailure) {
      return Promise.reject(new Error(evalFailure.message, { cause: evalFailure }));
    }

    if (script.includes("LRANGE")) {
      return Promise.resolve(runIsCurrent(args));
    }

    if (keyCount === 4 && args.length === 8) {
      return Promise.resolve(runAcquireOrSignal(args));
    }

    if (keyCount === 3 && args.length === 5) {
      return Promise.resolve(runCancelWaiter(args));
    }

    if (keyCount === 3 && args.length === 4) {
      if (deferConfirmation) {
        deferConfirmation = false;
        return new Promise((resolve) => {
          runDeferredConfirmation = () => resolve(runConfirmAcquisition(args));
        });
      }
      return Promise.resolve(runConfirmAcquisition(args));
    }

    if (keyCount === 1 && args.length === 3) {
      return Promise.resolve(runRenew(args));
    }

    if (keyCount === 1 && args.length === 2) {
      return Promise.resolve(runRelease(args));
    }

    return Promise.reject(
      new Error(`Unexpected EVAL call with ${keyCount} keys and ${args.length} arguments`),
    );
  };

  const rejectNextEval = (error: Error): void => {
    evalFailures.push(error);
  };

  const abortDuringNextAcquisition = (controller: AbortController): void => {
    acquireAbortController = controller;
  };

  const deferNextConfirmation = (): (() => void) => {
    deferConfirmation = true;
    return () => {
      runDeferredConfirmation?.();
      runDeferredConfirmation = null;
    };
  };

  const pushWaiter = (waiterKey: string, holderId: string): void => {
    const waiters = (lists.get(waiterKey) ?? []).filter((waiter) => waiter !== holderId);
    waiters.unshift(holderId);
    lists.set(waiterKey, waiters);
  };

  return {
    abortDuringNextAcquisition,
    deferNextConfirmation,
    get,
    set,
    del,
    eval: evalImpl,
    pushWaiter,
    rejectNextEval,
  };
};

const flushAsync = async (): Promise<void> => {
  for (let tick = 0; tick < 10; tick++) {
    await Promise.resolve();
  }
};

describe("createSyncLock", () => {
  const makeSyncLock = () => {
    const redis = createMockRedis();
    const syncLock = createSyncLock(redis);
    return { redis, syncLock };
  };

  const makeBackgroundSyncLock = () => {
    const redis = createMockRedis();
    const syncLock = createSyncLock(redis, "background");
    return { redis, syncLock };
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

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

  it("does not mutate waiter state for an already-aborted caller", async () => {
    const { redis, syncLock } = makeSyncLock();
    const firstResult = await syncLock.acquire("cal-1");
    if (!firstResult.acquired) {
      throw new Error("expected acquired");
    }
    const validWaiter = syncLock.acquire("cal-1");
    await flushAsync();
    const signalBefore = await redis.get(`${SIGNAL_PREFIX}cal-1`);

    const controller = new AbortController();
    controller.abort();
    await expect(syncLock.acquire("cal-1", controller.signal))
      .resolves.toEqual({ acquired: false });

    expect(await redis.get(`${SIGNAL_PREFIX}cal-1`)).toBe(signalBefore);
    await firstResult.handle.release();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    const waiterResult = await validWaiter;
    expect(waiterResult.acquired).toBe(true);
    if (waiterResult.acquired) {
      await waiterResult.handle.release();
    }
  });

  it("restores a predecessor when the latest caller aborts during acquisition", async () => {
    const { redis, syncLock } = makeSyncLock();
    const firstResult = await syncLock.acquire("cal-1");
    if (!firstResult.acquired) {
      throw new Error("expected acquired");
    }
    const predecessorPromise = syncLock.acquire("cal-1");
    await flushAsync();
    const predecessorSignal = await redis.get(`${SIGNAL_PREFIX}cal-1`);
    await firstResult.handle.release();

    const controller = new AbortController();
    redis.abortDuringNextAcquisition(controller);
    await expect(syncLock.acquire("cal-1", controller.signal))
      .resolves.toEqual({ acquired: false });
    expect(await redis.get(`${SIGNAL_PREFIX}cal-1`)).toBe(predecessorSignal);

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    const predecessorResult = await predecessorPromise;
    expect(predecessorResult.acquired).toBe(true);
    if (predecessorResult.acquired) {
      await predecessorResult.handle.release();
    }
  });

  it("rejects a provisional acquisition when a newer waiter arrives before confirmation", async () => {
    const { redis, syncLock } = makeSyncLock();
    const firstResult = await syncLock.acquire("cal-1");
    if (!firstResult.acquired) {
      throw new Error("expected acquired");
    }
    const predecessorPromise = syncLock.acquire("cal-1");
    await flushAsync();
    await firstResult.handle.release();

    const releaseConfirmation = redis.deferNextConfirmation();
    const provisionalPromise = syncLock.acquire("cal-1");
    await flushAsync();
    const latestPromise = syncLock.acquire("cal-1");
    await flushAsync();

    releaseConfirmation();
    await expect(provisionalPromise).resolves.toEqual({ acquired: false });
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);

    const latestResult = await latestPromise;
    expect(latestResult.acquired).toBe(true);
    await expect(predecessorPromise).resolves.toEqual({ acquired: false });
    if (latestResult.acquired) {
      await latestResult.handle.release();
    }
  });

  it("waits for a mutation blocker without replacing a destination waiter", async () => {
    const { redis, syncLock } = makeSyncLock();
    const blocker = await syncLock.acquire("mapping-mutation:user-1");
    expect(blocker.acquired).toBe(true);

    const resultPromise = syncLock.acquire(
      "cal-1",
      new AbortController().signal,
      "mapping-mutation:user-1",
    );
    await flushAsync();

    expect(await redis.get(`${SIGNAL_PREFIX}cal-1`)).toBeNull();
    if (blocker.acquired) {
      await blocker.handle.release();
    }
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

    const result = await resultPromise;
    expect(result.acquired).toBe(true);
    if (result.acquired) {
      await result.handle.release();
    }
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

      // Simulate a second caller queueing behind the holder
      redis.pushWaiter(`${WAITER_PREFIX}cal-1`, "waiter-id");

      const current = await firstResult.handle.isCurrent();
      expect(current).toBe(false);
    });

    it("stays current while another background sync waits behind it", async () => {
      const { syncLock } = makeBackgroundSyncLock();
      const firstResult = await syncLock.acquire("cal-1");

      if (!firstResult.acquired) {
        throw new Error("expected acquired");
      }

      const secondPromise = syncLock.acquire("cal-1");
      await flushAsync();

      expect(await firstResult.handle.isCurrent()).toBe(true);

      await firstResult.handle.release();
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      const secondResult = await secondPromise;
      expect(secondResult.acquired).toBe(true);
      if (secondResult.acquired) {
        await secondResult.handle.release();
      }
    });

    it("stops being current once a mapping mutation queues behind it", async () => {
      const { redis, syncLock } = makeBackgroundSyncLock();
      const mutationLock = createSyncLock(redis);
      const firstResult = await syncLock.acquire("cal-1");

      if (!firstResult.acquired) {
        throw new Error("expected acquired");
      }

      expect(await firstResult.handle.isCurrent()).toBe(true);

      const mutationPromise = mutationLock.acquire("cal-1");
      await flushAsync();

      expect(await firstResult.handle.isCurrent()).toBe(false);

      await firstResult.handle.release();
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      const mutationResult = await mutationPromise;
      expect(mutationResult.acquired).toBe(true);
      if (mutationResult.acquired) {
        await mutationResult.handle.release();
      }
    });

    it("treats an unprefixed waiter from an older deployment as preempting", async () => {
      const { redis, syncLock } = makeBackgroundSyncLock();
      const firstResult = await syncLock.acquire("cal-1");

      if (!firstResult.acquired) {
        throw new Error("expected acquired");
      }

      redis.pushWaiter(`${WAITER_PREFIX}cal-1`, "1f1a2b3c-legacy-holder-id");

      expect(await firstResult.handle.isCurrent()).toBe(false);
      await firstResult.handle.release();
    });

    it("reads the waiter list so a later background waiter cannot mask a preempting one", async () => {
      const { redis, syncLock } = makeBackgroundSyncLock();
      const firstResult = await syncLock.acquire("cal-1");

      if (!firstResult.acquired) {
        throw new Error("expected acquired");
      }

      const maskingWaiter = `${BACKGROUND_HOLDER_PREFIX}later-waiter`;
      redis.pushWaiter(`${WAITER_PREFIX}cal-1`, "preempting:mapping-mutation");
      redis.pushWaiter(`${WAITER_PREFIX}cal-1`, maskingWaiter);
      redis.set(`${SIGNAL_PREFIX}cal-1`, maskingWaiter);

      expect(await firstResult.handle.isCurrent()).toBe(false);
      await firstResult.handle.release();
    });

    it("returns false when the holder no longer owns the lock key", async () => {
      const { redis, syncLock } = makeSyncLock();
      const result = await syncLock.acquire("cal-1");

      if (!result.acquired) {
        throw new Error("expected acquired");
      }

      redis.del(`${LOCK_PREFIX}cal-1`);

      expect(await result.handle.isCurrent()).toBe(false);
    });

    it("returns false when another holder owns the lock key", async () => {
      const { redis, syncLock } = makeSyncLock();
      const result = await syncLock.acquire("cal-1");

      if (!result.acquired) {
        throw new Error("expected acquired");
      }

      redis.set(`${LOCK_PREFIX}cal-1`, "replacement-holder");

      expect(await result.handle.isCurrent()).toBe(false);
    });
  });

  describe("isHeld", () => {
    it("ignores waiters while confirming lock ownership", async () => {
      const { redis, syncLock } = makeSyncLock();
      const result = await syncLock.acquire("cal-1");

      if (!result.acquired) {
        throw new Error("expected acquired");
      }

      redis.pushWaiter(`${WAITER_PREFIX}cal-1`, "waiter-id");

      expect(await result.handle.isHeld()).toBe(true);
      expect(await result.handle.isCurrent()).toBe(false);
    });

    it("returns false after lock ownership is lost", async () => {
      const { redis, syncLock } = makeSyncLock();
      const result = await syncLock.acquire("cal-1");

      if (!result.acquired) {
        throw new Error("expected acquired");
      }

      redis.set(`${LOCK_PREFIX}cal-1`, "replacement-holder");

      expect(await result.handle.isHeld()).toBe(false);
    });
  });

  describe("renewal", () => {
    it("renews the lock before its original TTL expires", async () => {
      const { redis, syncLock } = makeSyncLock();
      const result = await syncLock.acquire("cal-1");

      if (!result.acquired) {
        throw new Error("expected acquired");
      }

      vi.advanceTimersByTime((LOCK_TTL_SECONDS * 1000) + LOCK_RENEW_INTERVAL_MS);
      await flushAsync();

      expect(await redis.get(`${LOCK_PREFIX}cal-1`)).not.toBeNull();
      expect(await result.handle.isCurrent()).toBe(true);
      await result.handle.release();
    });

    it("surfaces Redis renewal failures through the lock handle", async () => {
      const redis = createMockRedis();
      const syncLock = createSyncLock(redis);
      const result = await syncLock.acquire("cal-1");

      if (!result.acquired) {
        throw new Error("expected acquired");
      }

      const renewalFailure = new Error("Redis unavailable");
      redis.rejectNextEval(renewalFailure);
      vi.advanceTimersByTime(LOCK_RENEW_INTERVAL_MS);
      await flushAsync();

      await expect(result.handle.isCurrent()).rejects.toBeInstanceOf(SyncLockRenewalError);
      await expect(result.handle.isCurrent()).rejects.toEqual(
        expect.objectContaining({
          calendarId: "cal-1",
          cause: expect.objectContaining({ cause: renewalFailure }),
          name: "SyncLockRenewalError",
        }),
      );
      await result.handle.release();
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

      const secondPromise = syncLock.acquire("cal-1");
      await flushAsync();

      // Signal key should be set
      const signalValue = await redis.get(`${SIGNAL_PREFIX}cal-1`);
      expect(signalValue).not.toBeNull();

      // First holder sees it is no longer current
      const current = await firstResult.handle.isCurrent();
      expect(current).toBe(false);

      // Release the lock so the waiter can acquire
      await firstResult.handle.release();

      vi.advanceTimersByTime(POLL_INTERVAL_MS);
      await flushAsync();

      const secondResult = await secondPromise;
      expect(secondResult.acquired).toBe(true);
    });

    it("keeps a waiter visible beyond the renewable holder TTL", async () => {
      const { redis, syncLock } = makeSyncLock();
      const firstResult = await syncLock.acquire("cal-1");
      if (!firstResult.acquired) {
        throw new Error("expected acquired");
      }

      const secondPromise = syncLock.acquire("cal-1");
      await flushAsync();
      await vi.advanceTimersByTimeAsync((LOCK_TTL_SECONDS * 1000) + 1000);

      expect(await redis.get(`${SIGNAL_PREFIX}cal-1`)).not.toBeNull();
      expect(await firstResult.handle.isCurrent()).toBe(false);

      await firstResult.handle.release();
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
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
      await flushAsync();

      const secondSignal = await redis.get(`${SIGNAL_PREFIX}cal-1`);

      // Start third caller — should replace second
      const thirdPromise = syncLock.acquire("cal-1");
      await flushAsync();

      const thirdSignal = await redis.get(`${SIGNAL_PREFIX}cal-1`);
      expect(thirdSignal).not.toBe(secondSignal);

      // Release lock so third can acquire
      await firstResult.handle.release();

      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);

      const thirdResult = await thirdPromise;
      expect(thirdResult.acquired).toBe(true);
      const secondResult = await secondPromise;
      expect(secondResult.acquired).toBe(false);
    });

    it("waiter removes its signal when its abort signal is triggered", async () => {
      const { redis, syncLock } = makeSyncLock();

      const firstResult = await syncLock.acquire("cal-1");
      if (!firstResult.acquired) {
        throw new Error("expected acquired");
      }

      const abortController = new AbortController();

      const secondPromise = syncLock.acquire("cal-1", abortController.signal);
      await flushAsync();

      abortController.abort();

      vi.advanceTimersByTime(POLL_INTERVAL_MS);
      await flushAsync();

      const secondResult = await secondPromise;
      expect(secondResult.acquired).toBe(false);
      expect(await redis.get(`${SIGNAL_PREFIX}cal-1`)).toBeNull();
      expect(await firstResult.handle.isCurrent()).toBe(true);

      await firstResult.handle.release();
    });

    it("promotes the previous waiter when the latest waiter aborts", async () => {
      const { redis, syncLock } = makeSyncLock();
      const firstResult = await syncLock.acquire("cal-1");
      if (!firstResult.acquired) {
        throw new Error("expected acquired");
      }

      const secondPromise = syncLock.acquire("cal-1");
      await flushAsync();
      const secondSignal = await redis.get(`${SIGNAL_PREFIX}cal-1`);
      const thirdAbort = new AbortController();
      const thirdPromise = syncLock.acquire("cal-1", thirdAbort.signal);
      await flushAsync();

      expect(await redis.get(`${SIGNAL_PREFIX}cal-1`)).not.toBe(secondSignal);
      thirdAbort.abort();
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      await expect(thirdPromise).resolves.toEqual({ acquired: false });
      expect(await redis.get(`${SIGNAL_PREFIX}cal-1`)).toBe(secondSignal);

      await firstResult.handle.release();
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      const secondResult = await secondPromise;
      expect(secondResult.acquired).toBe(true);
      if (secondResult.acquired) {
        await secondResult.handle.release();
      }
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

      // Queue a waiter on cal-1 only
      redis.pushWaiter(`${WAITER_PREFIX}cal-1`, "waiter");

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
      await flushAsync();
      executionOrder.push("second:waiting");

      // Toggle 3: replaces second, waits
      const thirdPromise = syncLock.acquire("cal-1");
      await flushAsync();
      executionOrder.push("third:waiting");

      // First detects supersession, does its work, flushes, releases
      expect(await first.handle.isCurrent()).toBe(false);
      executionOrder.push("first:superseded", "first:flushed");
      await first.handle.release();
      executionOrder.push("first:released");

      // Advance so third can acquire
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);

      const thirdResult = await thirdPromise;
      const secondResult = await secondPromise;
      expect(secondResult.acquired).toBe(false);
      executionOrder.push("second:replaced");
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
        "first:superseded",
        "first:flushed",
        "first:released",
        "second:replaced",
        "third:acquired",
        "third:completed",
        "third:released",
      ]);
    });
  });
});
