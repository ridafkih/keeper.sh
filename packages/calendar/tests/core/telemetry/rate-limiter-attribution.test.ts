import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { widelog, widelogger } from "widelogger";
import { createRedisRateLimiter } from "../../../src/core/utils/redis-rate-limiter";

interface EmittedEvent {
  accounted_ms?: number;
  ratelimit?: {
    acquire_count?: number;
    queue_depth_max?: number;
    throttled_count?: number;
    window_occupancy_max?: number;
  };
  redis?: { command_ms_max?: number };
  source?: string;
  wait?: { rate_limiter_ms?: number };
}

const { context } = widelogger({
  defaultEventName: "wide_event",
  environment: "production",
  service: "calendar-test",
});

const emitted: EmittedEvent[] = [];
const originalWrite = process.stdout.write.bind(process.stdout);

beforeEach(() => {
  emitted.length = 0;
  process.stdout.write = ((chunk: unknown) => {
    for (const line of String(chunk).split("\n")) {
      if (line.trim().length > 0) {
        emitted.push(JSON.parse(line) as EmittedEvent);
      }
    }
    return true;
  }) as typeof process.stdout.write;
});

afterEach(() => {
  process.stdout.write = originalWrite;
});

const THROTTLE_WAIT_MS = 150;
const OCCUPANCY_WHEN_FULL = 30;
const SLOW_EVAL_MS = 25;

/*
 * A limiter whose first decisions are "wait", so the segment covers the sleep and
 * not merely the round trip. Every acquire ends by granting so the loop terminates.
 */
const createThrottlingRedis = (throttles: number, evalDelayMs = 0) => {
  let remaining = throttles;
  return {
    eval: async (): Promise<unknown> => {
      await Bun.sleep(evalDelayMs);
      if (remaining > 0) {
        remaining -= 1;
        return [THROTTLE_WAIT_MS, OCCUPANCY_WHEN_FULL];
      }
      return [0, 1];
    },
  };
};

const runInEvent = async (source: string, run: () => Promise<void>): Promise<void> => {
  await context(async () => {
    widelog.set("source", source);
    await run();
    widelog.flush();
  });
};

const eventFor = (source: string): EmittedEvent => {
  const event = emitted.find((candidate) => candidate.source === source);
  if (!event) {
    throw new Error(`no wide event was emitted for ${source}`);
  }
  return event;
};

describe("rate limiter wait attribution", () => {
  it("charges a throttled acquire to the enclosing wide event", async () => {
    const limiter = createRedisRateLimiter(createThrottlingRedis(1), "ratelimit:user-1:google", {
      requestsPerMinute: 30,
    });

    await runInEvent("only", () => limiter.acquire(1));

    const event = eventFor("only");
    expect(event.wait?.rate_limiter_ms).toBeGreaterThanOrEqual(THROTTLE_WAIT_MS);
    expect(event.ratelimit?.acquire_count).toBe(1);
    expect(event.ratelimit?.throttled_count).toBe(1);
    expect(event.ratelimit?.queue_depth_max).toBe(1);
    expect(event.ratelimit?.window_occupancy_max).toBe(OCCUPANCY_WHEN_FULL);
  });

  it("credits accounted_ms with exactly the wait it recorded", async () => {
    const limiter = createRedisRateLimiter(createThrottlingRedis(1), "ratelimit:user-2:google", {
      requestsPerMinute: 30,
    });

    await runInEvent("accounting", () => limiter.acquire(1));

    const event = eventFor("accounting");
    expect(event.accounted_ms).toBe(event.wait?.rate_limiter_ms);
  });

  it("overlays the redis round trip without adding it to accounted_ms", async () => {
    const limiter = createRedisRateLimiter(
      createThrottlingRedis(0, SLOW_EVAL_MS),
      "ratelimit:user-6:google",
      { requestsPerMinute: 30 },
    );

    await runInEvent("overlay", () => limiter.acquire(1));

    const event = eventFor("overlay");
    expect(event.redis?.command_ms_max).toBeGreaterThanOrEqual(SLOW_EVAL_MS);
    expect(event.accounted_ms).toBe(event.wait?.rate_limiter_ms);
  });

  it("keeps concurrent ingests on separate stores rather than clobbering one key", async () => {
    const slow = createRedisRateLimiter(createThrottlingRedis(3), "ratelimit:user-3:google", {
      requestsPerMinute: 30,
    });
    const fast = createRedisRateLimiter(createThrottlingRedis(0), "ratelimit:user-4:google", {
      requestsPerMinute: 30,
    });

    await Promise.all([
      runInEvent("slow", () => slow.acquire(1)),
      runInEvent("fast", () => fast.acquire(1)),
    ]);

    const slowEvent = eventFor("slow");
    const fastEvent = eventFor("fast");
    expect(slowEvent.ratelimit?.throttled_count).toBe(3);
    expect(fastEvent.ratelimit?.throttled_count).toBeUndefined();
    expect(slowEvent.wait?.rate_limiter_ms ?? 0).toBeGreaterThan(fastEvent.wait?.rate_limiter_ms ?? 0);
  });

  it("reports the shared-key herd depth on every waiter of the same user", async () => {
    const key = "ratelimit:user-5:google";
    const limiters = [1, 2, 3].map(() =>
      createRedisRateLimiter(createThrottlingRedis(1), key, { requestsPerMinute: 30 }));

    await Promise.all(limiters.map((limiter, index) =>
      runInEvent(`herd-${index}`, () => limiter.acquire(1))));

    const depths = [0, 1, 2].map((index) => eventFor(`herd-${index}`).ratelimit?.queue_depth_max);
    expect(Math.max(...depths.map((depth) => depth ?? 0))).toBe(3);
  });

  it("stops the timer when the acquire is aborted mid-wait", async () => {
    const limiter = createRedisRateLimiter(createThrottlingRedis(10), "ratelimit:user-7:google", {
      requestsPerMinute: 30,
    });
    const controller = new AbortController();

    await runInEvent("aborted", async () => {
      const pending = limiter.acquire(1, controller.signal);
      setTimeout(() => controller.abort(new Error("source deadline exceeded")), THROTTLE_WAIT_MS);
      await pending.catch(() => null);
    });

    const event = eventFor("aborted");
    expect(event.wait?.rate_limiter_ms).toBeGreaterThan(0);
  });
});
