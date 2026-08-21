import { INGEST_SOURCE_TIMEOUT_MS } from "@keeper.sh/constants";
import { BACKGROUND_HOLDER_PREFIX, createSyncLock, POLL_INTERVAL_MS } from "../../../../packages/sync/src/sync-lock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface StoredString {
  expiresAt: number;
  value: string;
}

interface StoredList {
  expiresAt: number;
  items: string[];
}

const CALENDAR_ID = "calendar-long-run";
const SETTLE_TICKS = 4;

const createFakeRedis = () => {
  const strings = new Map<string, StoredString>();
  const lists = new Map<string, StoredList>();

  const readString = (key: string): string | null => {
    const entry = strings.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= Date.now()) {
      strings.delete(key);
      return null;
    }
    return entry.value;
  };

  const readList = (key: string): string[] => {
    const entry = lists.get(key);
    if (!entry) {
      return [];
    }
    if (entry.expiresAt <= Date.now()) {
      lists.delete(key);
      return [];
    }
    return entry.items;
  };

  const writeString = (key: string, value: string, ttlSeconds: number): void => {
    strings.set(key, { expiresAt: Date.now() + (ttlSeconds * 1000), value });
  };

  const writeList = (key: string, items: string[], ttlSeconds: number): void => {
    lists.set(key, { expiresAt: Date.now() + (ttlSeconds * 1000), items });
  };

  const acquireOrSignal = (args: string[]): unknown => {
    const [lockKey = "", signalKey = "", , waiterKey = "", holderId = "", lockTtl = "0", signalTtl = "0"] = args;
    const waiters = readList(waiterKey).filter((item) => item !== holderId);
    waiters.unshift(holderId);
    writeList(waiterKey, waiters, Number(signalTtl));
    const lockHolder = readString(lockKey);
    const existingSignal = readString(signalKey);
    writeString(signalKey, holderId, Number(signalTtl));
    if (!lockHolder) {
      writeString(lockKey, holderId, Number(lockTtl));
      return "acquired";
    }
    if (existingSignal) {
      return "replaced";
    }
    return "queued";
  };

  const confirmAcquisition = (args: string[]): unknown => {
    const [lockKey = "", signalKey = "", waiterKey = "", holderId = ""] = args;
    const [head] = readList(waiterKey);
    if (readString(lockKey) !== holderId || readString(signalKey) !== holderId || head !== holderId) {
      return 0;
    }
    strings.delete(signalKey);
    lists.delete(waiterKey);
    return 1;
  };

  const cancelWaiter = (args: string[]): unknown => {
    const [signalKey = "", waiterKey = "", lockKey = "", holderId = "", signalTtl = "0"] = args;
    if (readString(lockKey) === holderId) {
      strings.delete(lockKey);
    }
    const waiters = readList(waiterKey).filter((item) => item !== holderId);
    const [next] = waiters;
    if (next) {
      writeString(signalKey, next, Number(signalTtl));
      writeList(waiterKey, waiters, Number(signalTtl));
      return next;
    }
    strings.delete(signalKey);
    lists.delete(waiterKey);
    return "";
  };

  const renewLock = (args: string[]): unknown => {
    const [lockKey = "", holderId = "", lockTtl = "0"] = args;
    if (readString(lockKey) !== holderId) {
      return 0;
    }
    writeString(lockKey, holderId, Number(lockTtl));
    return 1;
  };

  const releaseLock = (args: string[]): unknown => {
    const [lockKey = "", holderId = ""] = args;
    if (readString(lockKey) !== holderId) {
      return 0;
    }
    strings.delete(lockKey);
    return 1;
  };

  const isCurrent = (args: string[]): unknown => {
    const [lockKey = "", waiterKey = "", holderId = ""] = args;
    if (readString(lockKey) !== holderId) {
      return 0;
    }
    const superseded = readList(waiterKey).some((waiter) =>
      waiter !== holderId && !waiter.startsWith(BACKGROUND_HOLDER_PREFIX));
    if (superseded) {
      return 0;
    }
    return 1;
  };

  const evalImpl = (script: string, keyCount: number, ...args: string[]): Promise<unknown> => {
    if (script.includes("LRANGE")) {
      return Promise.resolve(isCurrent(args));
    }
    if (keyCount === 4) {
      return Promise.resolve(acquireOrSignal(args));
    }
    if (keyCount === 3 && args.length === 5) {
      return Promise.resolve(cancelWaiter(args));
    }
    if (keyCount === 3) {
      return Promise.resolve(confirmAcquisition(args));
    }
    if (args.length === 3) {
      return Promise.resolve(renewLock(args));
    }
    if (args.length === 2) {
      return Promise.resolve(releaseLock(args));
    }
    return Promise.reject(new Error(`unexpected EVAL: ${keyCount} keys, ${args.length} args`));
  };

  return {
    eval: evalImpl,
    get: (key: string) => Promise.resolve(readString(key)),
  };
};

describe("a webhook ingest still preempts a long fleet run", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("serves the webhook waiter queued behind a fleet run at the maximum permitted ingest duration", async () => {
    const redis = createFakeRedis();
    const fleetLock = createSyncLock(redis, "background");
    const pushLock = createSyncLock(redis, "preempting");

    const fleetRun = await fleetLock.acquire(CALENDAR_ID);
    if (!fleetRun.acquired) {
      throw new Error("the fleet run should have taken a free lock");
    }

    const webhookWaiter = pushLock.acquire(CALENDAR_ID);
    const fleetCompletion: Promise<void>[] = [];
    setTimeout(() => {
      fleetCompletion.push(fleetRun.handle.release());
    }, INGEST_SOURCE_TIMEOUT_MS);

    await vi.advanceTimersByTimeAsync(INGEST_SOURCE_TIMEOUT_MS + (POLL_INTERVAL_MS * SETTLE_TICKS));
    await Promise.all(fleetCompletion);

    const served = await webhookWaiter;

    expect(served.acquired).toBe(true);
  });

  it("still reports the fleet holder superseded when it reaches the maximum permitted ingest duration", async () => {
    const redis = createFakeRedis();
    const fleetLock = createSyncLock(redis, "background");
    const pushLock = createSyncLock(redis, "preempting");

    const fleetRun = await fleetLock.acquire(CALENDAR_ID);
    if (!fleetRun.acquired) {
      throw new Error("the fleet run should have taken a free lock");
    }

    const webhookWaiter = pushLock.acquire(CALENDAR_ID);
    const observed: boolean[] = [];
    const fleetCompletion: Promise<void>[] = [];
    const finishFleetRun = async (): Promise<void> => {
      observed.push(await fleetRun.handle.isCurrent());
      await fleetRun.handle.release();
    };
    setTimeout(() => {
      fleetCompletion.push(finishFleetRun());
    }, INGEST_SOURCE_TIMEOUT_MS);

    await vi.advanceTimersByTimeAsync(INGEST_SOURCE_TIMEOUT_MS + (POLL_INTERVAL_MS * SETTLE_TICKS));
    await Promise.all(fleetCompletion);
    await webhookWaiter;

    expect(observed).toEqual([false]);
  });
});
