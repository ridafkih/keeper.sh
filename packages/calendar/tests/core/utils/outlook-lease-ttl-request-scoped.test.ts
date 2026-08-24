import { INGEST_SOURCE_TIMEOUT_MS, PROVIDER_INGEST_REQUEST_TIMEOUT_MS } from "@keeper.sh/constants";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOutlookAccountSemaphore } from "../../../src/core/utils/redis-rate-limiter";

const OUTLOOK_CAPACITY = 3;
const SETTLE_MS = 1000;
const RAISED_INGEST_TIMEOUT_MS = INGEST_SOURCE_TIMEOUT_MS * 2;

interface FakeEntry {
  expiresAt: number;
  value: string;
}

class FakeRedis {
  public store = new Map<string, FakeEntry>();

  public ttls: number[] = [];

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
        const ttlMs = Number(options[index + 1]);
        this.ttls.push(ttlMs);
        expiresAt = Date.now() + ttlMs;
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

const grantedTtlMs = async (): Promise<number> => {
  const redis = new FakeRedis();
  const semaphore = createOutlookAccountSemaphore(redis, "account-ttl");
  await semaphore.acquireLease();
  const [ttlMs] = redis.ttls;
  expect(typeof ttlMs).toBe("number");
  return Number(ttlMs);
};

describe("outlook lease ttl", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock("@keeper.sh/constants");
    vi.resetModules();
  });

  it("sizes the lease to one provider request, not to the ingest deadline", async () => {
    const ttlMs = await grantedTtlMs();

    expect(ttlMs).toBeGreaterThanOrEqual(PROVIDER_INGEST_REQUEST_TIMEOUT_MS);
    expect(ttlMs).toBeLessThan(INGEST_SOURCE_TIMEOUT_MS);
  });

  it("does not move when the ingest deadline is raised", async () => {
    const baseline = await grantedTtlMs();

    vi.resetModules();
    vi.doMock("@keeper.sh/constants", async () => {
      const actual = await vi.importActual<Record<string, unknown>>("@keeper.sh/constants");
      return { ...actual, INGEST_SOURCE_TIMEOUT_MS: RAISED_INGEST_TIMEOUT_MS };
    });
    const reloaded = await import("../../../src/core/utils/redis-rate-limiter");
    const redis = new FakeRedis();
    const semaphore = reloaded.createOutlookAccountSemaphore(redis, "account-ttl");
    await semaphore.acquireLease();

    expect(redis.ttls[0]).toBe(baseline);
  });

  it("moves with the provider request timeout", async () => {
    const baseline = await grantedTtlMs();

    vi.resetModules();
    vi.doMock("@keeper.sh/constants", async () => {
      const actual = await vi.importActual<Record<string, unknown>>("@keeper.sh/constants");
      return { ...actual, PROVIDER_INGEST_REQUEST_TIMEOUT_MS: PROVIDER_INGEST_REQUEST_TIMEOUT_MS * 2 };
    });
    const reloaded = await import("../../../src/core/utils/redis-rate-limiter");
    const redis = new FakeRedis();
    const semaphore = reloaded.createOutlookAccountSemaphore(redis, "account-ttl");
    await semaphore.acquireLease();

    expect(redis.ttls[0]).toBe(baseline + PROVIDER_INGEST_REQUEST_TIMEOUT_MS);
  });

  it("outlives one request and then frees the slot of a crashed holder", async () => {
    const redis = new FakeRedis();
    const semaphore = createOutlookAccountSemaphore(redis, "account-crash");
    for (let index = 0; index < OUTLOOK_CAPACITY; index += 1) {
      await semaphore.acquireLease();
    }

    await vi.advanceTimersByTimeAsync(PROVIDER_INGEST_REQUEST_TIMEOUT_MS);
    const duringRequest = probe(semaphore.acquireLease());
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(duringRequest.status).toBe("pending");

    const ttlMs = Number(redis.ttls[0]);
    await vi.advanceTimersByTimeAsync(ttlMs);
    expect(duringRequest.status).toBe("resolved");
  });
});
