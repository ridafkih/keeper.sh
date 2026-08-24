import { afterEach, describe, expect, it, vi } from "vitest";
import { createRedisRateLimiter } from "../../../src/core/utils/redis-rate-limiter";

const LIMIT = 4;
const WINDOW_ARGUMENT_COUNT = 5;
const RETRY_HINT_MS = 50;
const POLL_STEP_MS = 400;
const RELEASE_PLAN = [1, 1, 1, 3];

interface FairWindowRedis {
  eval(script: string, numberOfKeys: number, ...arguments_: string[]): Promise<unknown>;
  release(slots: number): void;
}

/*
 * Stands in for the acquire script under a clock the test advances by hand. A waiter
 * names itself with a token carried past the five window arguments, joins one FIFO
 * queue on its first park, and is admitted only from the head — so a later arrival
 * cannot take a slot an earlier waiter is still parked on. A caller that sends no
 * token is served by window room alone, which is the poll-and-race the fix replaces.
 */
const createFairWindowRedis = (): FairWindowRedis => {
  let occupancy = LIMIT;
  const queue: string[] = [];

  const evaluate = (
    _script: string,
    _numberOfKeys: number,
    ...arguments_: string[]
  ): Promise<unknown> => {
    const count = Number(arguments_[3]);
    const token = arguments_.slice(WINDOW_ARGUMENT_COUNT).join("|");
    const occupancyBefore = occupancy;
    const hasRoom = occupancy + count <= LIMIT;

    if (token === "") {
      if (hasRoom) {
        occupancy += count;
        return Promise.resolve([0, occupancyBefore]);
      }
      return Promise.resolve([RETRY_HINT_MS, occupancyBefore]);
    }

    const [head] = queue;
    if (hasRoom && (queue.length === 0 || head === token)) {
      occupancy += count;
      if (head === token) {
        queue.shift();
      }
      return Promise.resolve([0, occupancyBefore]);
    }

    if (!queue.includes(token)) {
      queue.push(token);
    }
    return Promise.resolve([RETRY_HINT_MS, occupancyBefore]);
  };

  const release = (slots: number): void => {
    occupancy -= slots;
  };

  return { eval: evaluate, release };
};

const settle = async (durationMs: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(durationMs);
  await vi.advanceTimersByTimeAsync(0);
};

describe("a parked acquire is granted in arrival order", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("grants parked acquires in arrival order rather than to whoever polls first", async () => {
    vi.useFakeTimers();
    const redis = createFairWindowRedis();
    const limiter = createRedisRateLimiter(redis, "ratelimit:caldav-account:fastmail", {
      requestsPerMinute: LIMIT,
    });
    const granted: string[] = [];
    const park = async (name: string, slots: number): Promise<void> => {
      await limiter.acquire(slots);
      granted.push(name);
    };

    const first = park("first", 3);
    await settle(0);
    const second = park("second", 1);
    await settle(0);
    const third = park("third", 1);
    await settle(0);

    expect(granted).toEqual([]);

    for (const slots of RELEASE_PLAN) {
      redis.release(slots);
      await settle(POLL_STEP_MS);
    }

    await Promise.all([first, second, third]);

    expect(granted).toEqual(["first", "second", "third"]);
  });
});
