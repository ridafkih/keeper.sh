import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOutlookAccountRequestLimiter } from "../../../../../src/core/utils/redis-rate-limiter";
import { fetchCalendarEvents } from "../../../../../src/providers/outlook/source/utils/fetch-events";
import type { RedisRateLimiter } from "../../../../../src/core/utils/redis-rate-limiter";

const ACCOUNT_ID = "account-a";
const IN_FLIGHT_REQUESTS = 3;
const TIME_MIN = new Date("2026-07-01T00:00:00.000Z");
const TIME_MAX = new Date("2026-07-31T00:00:00.000Z");

const originalFetch = globalThis.fetch;

const slotKey = (slot: number): string => `semaphore:outlook:account:${ACCOUNT_ID}:slot:${slot}`;

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

const heldSlotKeys = (redis: FakeRedis): string[] =>
  [...redis.store.keys()]
    .filter((key) => key.startsWith(`semaphore:outlook:account:${ACCOUNT_ID}:slot:`))
    .toSorted();

interface PendingRequest {
  reject: (reason: unknown) => void;
  resolve: (response: Response) => void;
}

const startFetchCalendarEvents = (limiter: RedisRateLimiter): SettlementProbe => probe(
  fetchCalendarEvents({
    accessToken: "token",
    calendarId: "calendar-a",
    rateLimiter: limiter,
    timeMax: TIME_MAX,
    timeMin: TIME_MIN,
  }),
);

describe("outlook mailbox permit identity", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  it("frees the failing request's own slot and leaves an in-flight sibling's slot held", async () => {
    const redis = new FakeRedis();
    const pending: PendingRequest[] = [];
    const pausedFetch = (): Promise<Response> => new Promise((resolve, reject) => {
      pending.push({ reject, resolve });
    });
    pausedFetch.preconnect = originalFetch.preconnect;
    globalThis.fetch = pausedFetch;

    const limiter = createOutlookAccountRequestLimiter(redis, ACCOUNT_ID);
    const requests: SettlementProbe[] = [];
    for (let index = 0; index < IN_FLIGHT_REQUESTS; index += 1) {
      requests.push(startFetchCalendarEvents(limiter));
      await vi.advanceTimersByTimeAsync(1);
      expect(pending).toHaveLength(index + 1);
    }
    expect(heldSlotKeys(redis)).toEqual([slotKey(0), slotKey(1), slotKey(2)]);

    const [first] = pending;
    const last = requests[IN_FLIGHT_REQUESTS - 1];
    if (!first || !last) {
      throw new Error("expected the paused Graph requests to be recorded");
    }
    first.reject(new TypeError("graph connection reset"));
    await vi.advanceTimersByTimeAsync(1);

    expect(requests[0]?.status).toBe("rejected");
    expect(last.status).toBe("pending");
    expect(heldSlotKeys(redis)).toEqual([slotKey(1), slotKey(2)]);
  });
});
