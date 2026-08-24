import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLeasedSemaphore } from "../../../src/core/utils/leased-semaphore";

const CAPACITY = 2;
const TTL_MS = 5000;
const SETTLE_MS = 500;
const WELL_UNDER_TTL_MS = 2000;

interface FakeEntry {
  expiresAt: number;
  value: string;
}

class FakeRedis {
  public store = new Map<string, FakeEntry>();

  private prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt <= now) {
        this.store.delete(key);
      }
    }
  }

  public set(key: string, value: string, ...options: string[]): Promise<string | null> {
    this.prune();
    let expiresAt = Number.POSITIVE_INFINITY;
    let onlyIfAbsent = false;
    for (let index = 0; index < options.length; index += 1) {
      const option = String(options[index]).toUpperCase();
      if (option === "NX") {
        onlyIfAbsent = true;
      }
      if (option === "PX") {
        expiresAt = Date.now() + Number(options[index + 1]);
        index += 1;
      }
    }
    if (onlyIfAbsent && this.store.has(key)) {
      return Promise.resolve(null);
    }
    this.store.set(key, { expiresAt, value });
    return Promise.resolve("OK");
  }

  public del(...keys: string[]): Promise<number> {
    this.prune();
    let removed = 0;
    for (const key of keys) {
      if (this.store.delete(key)) {
        removed += 1;
      }
    }
    return Promise.resolve(removed);
  }
}

interface SettlementProbe {
  status: "pending" | "rejected" | "resolved";
}

const probe = (promise: Promise<unknown>): SettlementProbe => {
  const state: SettlementProbe = { status: "pending" };
  promise
    .then(() => {
      state.status = "resolved";
      return null;
    })
    .catch(() => {
      state.status = "rejected";
    });
  return state;
};

describe("createLeasedSemaphore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("grants exactly capacity concurrent leases and parks the next acquirer", async () => {
    const redis = new FakeRedis();
    const semaphore = createLeasedSemaphore(redis, { capacity: CAPACITY, ttlMs: TTL_MS });

    const first = await semaphore.acquireLease("account-1");
    const second = await semaphore.acquireLease("account-1");
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();

    const waiter = probe(semaphore.acquireLease("account-1"));
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(waiter.status).toBe("pending");
  });

  it("admits a waiter as soon as a lease is released", async () => {
    const redis = new FakeRedis();
    const semaphore = createLeasedSemaphore(redis, { capacity: CAPACITY, ttlMs: TTL_MS });

    const first = await semaphore.acquireLease("account-1");
    await semaphore.acquireLease("account-1");
    const waiter = probe(semaphore.acquireLease("account-1"));
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(waiter.status).toBe("pending");

    await semaphore.release(first);
    await vi.advanceTimersByTimeAsync(WELL_UNDER_TTL_MS);
    expect(waiter.status).toBe("resolved");
  });

  it("frees a crashed holder's slot after its TTL expires", async () => {
    const redis = new FakeRedis();
    const semaphore = createLeasedSemaphore(redis, { capacity: 1, ttlMs: TTL_MS });

    await semaphore.acquireLease("account-1");
    const waiter = probe(semaphore.acquireLease("account-1"));
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(waiter.status).toBe("pending");

    await vi.advanceTimersByTimeAsync(TTL_MS + 3000);
    expect(waiter.status).toBe("resolved");
  });

  it("does not let a stale holder's release destroy a lease reclaimed after TTL lapse", async () => {
    const redis = new FakeRedis();
    const semaphore = createLeasedSemaphore(redis, { capacity: 1, ttlMs: TTL_MS });

    const stale = await semaphore.acquireLease("account-1");
    await vi.advanceTimersByTimeAsync(TTL_MS + 1000);

    const fresh = await semaphore.acquireLease("account-1");
    expect(fresh.slotKey).toBe(stale.slotKey);
    expect(fresh.token).not.toBe(stale.token);

    await semaphore.release(stale);
    expect(redis.store.get(fresh.slotKey)?.value).toBe(fresh.token);

    const waiter = probe(semaphore.acquireLease("account-1"));
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(waiter.status).toBe("pending");
  });

  it("stops a parked waiter with the abort reason when the signal aborts", async () => {
    const redis = new FakeRedis();
    const semaphore = createLeasedSemaphore(redis, { capacity: 1, ttlMs: TTL_MS });

    await semaphore.acquireLease("account-1");
    const controller = new AbortController();
    const pending = semaphore.acquireLease("account-1", controller.signal);
    const waiter = probe(pending);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(waiter.status).toBe("pending");

    controller.abort(new Error("source deadline exceeded"));
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(waiter.status).toBe("rejected");
    await expect(pending).rejects.toThrow("source deadline exceeded");
  });
});
