import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  source?: string;
  wait?: { rate_limiter_key?: string; rate_limiter_ms?: number };
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

const LIMIT = 240;
const WINDOW_ARGUMENT_COUNT = 5;
const ROOM_OCCUPANCY = 12;
const FULL_OCCUPANCY = 240;
const THROTTLE_WAIT_MS = 5;
const THROTTLE_COUNT = 2;
/* Larger than any single replica's parked count, so a depth read off a per-process tally cannot produce it. */
const FLEET_QUEUE_DEPTH = 9;

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

const tailArgumentsOf = (call: unknown[]): string[] => call.slice(2) as string[];

describe("the uncontended fast path and the telemetry are unchanged", () => {
  it("grants an acquire with window room on one round trip that never touches the queue", async () => {
    const evaluate = vi.fn(() => Promise.resolve([0, ROOM_OCCUPANCY]));
    const limiter = createRedisRateLimiter({ eval: evaluate }, "ratelimit:caldav-account:roomy", {
      requestsPerMinute: LIMIT,
    });

    await runInEvent("uncontended", () => limiter.acquire(1));

    expect(evaluate).toHaveBeenCalledOnce();
    const [firstCall] = vi.mocked(evaluate).mock.calls;
    expect(tailArgumentsOf(firstCall as unknown[])).toHaveLength(WINDOW_ARGUMENT_COUNT);
  });

  it("emits every telemetry key with its current meaning for an uncontended acquire", async () => {
    const evaluate = vi.fn(() => Promise.resolve([0, ROOM_OCCUPANCY]));
    const limiter = createRedisRateLimiter({ eval: evaluate }, "ratelimit:caldav-account:roomy", {
      requestsPerMinute: LIMIT,
    });

    await runInEvent("uncontended-telemetry", () => limiter.acquire(1));

    const event = eventFor("uncontended-telemetry");
    expect(event.ratelimit?.acquire_count).toBe(1);
    expect(event.ratelimit?.throttled_count).toBeUndefined();
    expect(event.ratelimit?.window_occupancy_max).toBe(ROOM_OCCUPANCY);
    expect(event.ratelimit?.queue_depth_max).toBeUndefined();
    /* An acquire that never parked waited on nothing, so it must not name a key. */
    expect(event.wait?.rate_limiter_key).toBeUndefined();
    expect(event.wait?.rate_limiter_ms).toBeGreaterThanOrEqual(0);
    expect(event.accounted_ms).toBe(event.wait?.rate_limiter_ms);
  });

  it("counts one acquire, one throttle per refusal and the fleet queue depth when an acquire parks", async () => {
    const key = "ratelimit:caldav-account:saturated";
    let refusalsLeft = THROTTLE_COUNT;
    const evaluate = vi.fn((_script: string, _numberOfKeys: number, ...arguments_: string[]) => {
      const parked = arguments_.length > WINDOW_ARGUMENT_COUNT;
      if (refusalsLeft > 0) {
        refusalsLeft -= 1;
        if (parked) {
          return Promise.resolve([THROTTLE_WAIT_MS, FULL_OCCUPANCY, FLEET_QUEUE_DEPTH]);
        }
        return Promise.resolve([THROTTLE_WAIT_MS, FULL_OCCUPANCY]);
      }
      return Promise.resolve([0, FULL_OCCUPANCY, FLEET_QUEUE_DEPTH]);
    });
    const limiter = createRedisRateLimiter({ eval: evaluate }, key, {
      requestsPerMinute: LIMIT,
    });

    await runInEvent("contended", () => limiter.acquire(1));

    const event = eventFor("contended");
    expect(event.ratelimit?.acquire_count).toBe(1);
    expect(event.ratelimit?.throttled_count).toBe(THROTTLE_COUNT);
    expect(event.ratelimit?.window_occupancy_max).toBe(FULL_OCCUPANCY);
    expect(event.ratelimit?.queue_depth_max).toBe(FLEET_QUEUE_DEPTH);
    expect(event.wait?.rate_limiter_key).toBe(key);
    expect(event.wait?.rate_limiter_ms).toBeGreaterThan(0);
    expect(event.accounted_ms).toBe(event.wait?.rate_limiter_ms);
  });

  it("parks on the queue only after the untokened attempt is refused", async () => {
    const key = "ratelimit:caldav-account:late-join";
    let refusalsLeft = THROTTLE_COUNT;
    const evaluate = vi.fn(() => {
      if (refusalsLeft > 0) {
        refusalsLeft -= 1;
        return Promise.resolve([THROTTLE_WAIT_MS, FULL_OCCUPANCY, FLEET_QUEUE_DEPTH]);
      }
      return Promise.resolve([0, FULL_OCCUPANCY, FLEET_QUEUE_DEPTH]);
    });
    const limiter = createRedisRateLimiter({ eval: evaluate }, key, {
      requestsPerMinute: LIMIT,
    });

    await limiter.acquire(1);

    const calls = vi.mocked(evaluate).mock.calls as unknown[][];
    const tokenCarryingCalls = calls.filter(
      (call) => tailArgumentsOf(call).length > WINDOW_ARGUMENT_COUNT,
    );
    expect(tailArgumentsOf(calls[0] as unknown[])).toHaveLength(WINDOW_ARGUMENT_COUNT);
    expect(tokenCarryingCalls).toHaveLength(calls.length - 1);
  });
});
