import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOutlookAccountRequestLimiter } from "../../../../../src/core/utils/redis-rate-limiter";
import { fetchCalendarEvents } from "../../../../../src/providers/outlook/source/utils/fetch-events";
import type { RedisRateLimiter } from "../../../../../src/core/utils/redis-rate-limiter";

const MAILBOX_REQUEST_CEILING = 3;
const ACCOUNT_ID = "account-a";
const SETTLE_MS = 2000;
const TIME_MIN = new Date("2026-07-01T00:00:00.000Z");
const TIME_MAX = new Date("2026-07-31T00:00:00.000Z");

const originalFetch = globalThis.fetch;

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
  [...redis.store.keys()].filter((key) => key.startsWith(`semaphore:outlook:account:${ACCOUNT_ID}:slot:`));

const rejectingFetch = (): Promise<Response> =>
  Promise.reject(new TypeError("graph connection reset"));
rejectingFetch.preconnect = originalFetch.preconnect;

const hangingFetch = (_input: Request | URL | string, init?: RequestInit): Promise<Response> =>
  new Promise((_resolve, reject) => {
    const requestSignal = init?.signal;
    requestSignal?.addEventListener("abort", () => {
      reject(requestSignal.reason);
    }, { once: true });
  });
hangingFetch.preconnect = originalFetch.preconnect;

const fetchWithLimiter = (
  limiter: RedisRateLimiter,
  signal?: AbortSignal,
): Promise<unknown> => fetchCalendarEvents({
  accessToken: "token",
  calendarId: "calendar-a",
  rateLimiter: limiter,
  signal,
  timeMax: TIME_MAX,
  timeMin: TIME_MIN,
});

describe("outlook mailbox permit release", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  it("frees the permit when a request rejects or is aborted mid-flight", async () => {
    const redis = new FakeRedis();

    globalThis.fetch = rejectingFetch;
    await expect(fetchWithLimiter(createOutlookAccountRequestLimiter(redis, ACCOUNT_ID)))
      .rejects.toThrow();

    globalThis.fetch = hangingFetch;
    const controller = new AbortController();
    const abandoned = probe(
      fetchWithLimiter(createOutlookAccountRequestLimiter(redis, ACCOUNT_ID), controller.signal),
    );
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(new Error("ingest deadline"));
    await vi.advanceTimersByTimeAsync(0);
    expect(abandoned.status).toBe("rejected");

    expect(heldSlotKeys(redis)).toHaveLength(0);

    const survivor = createOutlookAccountRequestLimiter(redis, ACCOUNT_ID);
    const grants = [];
    for (let index = 0; index < MAILBOX_REQUEST_CEILING; index += 1) {
      grants.push(probe(survivor.acquire(1)));
    }
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    for (const grant of grants) {
      expect(grant.status).toBe("resolved");
    }
  });
});
