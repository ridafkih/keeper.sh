import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOutlookAccountSemaphore } from "../../../src/core/utils/redis-rate-limiter";

// One under Graph's documented MailboxConcurrency of 4.
const OUTLOOK_CAPACITY = 3;
const SETTLE_MS = 500;
const WELL_UNDER_LEASE_TTL_MS = 2000;

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

describe("createOutlookAccountSemaphore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("grants exactly three concurrent leases per account and parks the fourth", async () => {
    const redis = new FakeRedis();
    const semaphore = createOutlookAccountSemaphore(redis, "account-a");

    const leases = [];
    for (let index = 0; index < OUTLOOK_CAPACITY; index += 1) {
      leases.push(await semaphore.acquireLease());
    }
    for (const lease of leases) {
      expect(lease).toBeTruthy();
    }

    const fourth = probe(semaphore.acquireLease());
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(fourth.status).toBe("pending");
  });

  it("admits a parked acquirer once a lease on the same account is released", async () => {
    const redis = new FakeRedis();
    const semaphore = createOutlookAccountSemaphore(redis, "account-a");

    const first = await semaphore.acquireLease();
    await semaphore.acquireLease();
    await semaphore.acquireLease();
    const waiter = probe(semaphore.acquireLease());
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(waiter.status).toBe("pending");

    await semaphore.release(first);
    await vi.advanceTimersByTimeAsync(WELL_UNDER_LEASE_TTL_MS);
    expect(waiter.status).toBe("resolved");
  });

  it("gives distinct accounts independent capacity", async () => {
    const redis = new FakeRedis();
    const semaphoreA = createOutlookAccountSemaphore(redis, "account-a");
    const semaphoreB = createOutlookAccountSemaphore(redis, "account-b");

    for (let index = 0; index < OUTLOOK_CAPACITY; index += 1) {
      await semaphoreA.acquireLease();
    }
    const parked = probe(semaphoreA.acquireLease());
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(parked.status).toBe("pending");

    const grants = [];
    for (let index = 0; index < OUTLOOK_CAPACITY; index += 1) {
      grants.push(probe(semaphoreB.acquireLease()));
    }
    await vi.advanceTimersByTimeAsync(0);
    for (const grant of grants) {
      expect(grant.status).toBe("resolved");
    }
  });
});
