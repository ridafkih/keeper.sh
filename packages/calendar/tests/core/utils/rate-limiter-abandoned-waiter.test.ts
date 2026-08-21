import { afterEach, describe, expect, it, vi } from "vitest";
import { isIngestPacingParkAbortError } from "../../../src/core/utils/pacing-park";
import { createRedisRateLimiter } from "../../../src/core/utils/redis-rate-limiter";

const LIMIT = 2;
const WINDOW_ARGUMENT_COUNT = 5;
const TOKEN_ARGUMENT_INDEX = 5;
const TTL_ARGUMENT_INDEX = 6;
const RETRY_HINT_MS = 50;
const SETTLED_POLLS_MS = 2000;
/* Longer than any TTL a fix may pick: the spec only bounds it from below, by SOURCE_TIMEOUT_MS. */
const BEYOND_ANY_TTL_MS = 400_000;
const READINESS_STEP_MS = 40;
const READINESS_ATTEMPTS = 60;

interface QueueRedis {
  eval(script: string, numberOfKeys: number, ...arguments_: string[]): Promise<unknown>;
  queuedTokens(): string[];
  release(slots: number): void;
  seedAbandonedEntry(token: string): void;
}

/*
 * Stands in for the acquire script. Window occupancy is a counter the test drives
 * directly; only the wait queue carries arrival times, because arrival time is what
 * this spec is about. A tokened call purges entries older than the TTL it was handed,
 * then admits from the head only, so a stale head entry blocks everyone behind it.
 */
const createQueueRedis = (onJoin?: (token: string) => void): QueueRedis => {
  let occupancy = LIMIT;
  const arrivalByToken = new Map<string, number>();

  const purgeExpired = (nowMs: number, ttlMs: number): void => {
    for (const [token, arrivalMs] of arrivalByToken) {
      if (arrivalMs <= nowMs - ttlMs) {
        arrivalByToken.delete(token);
      }
    }
  };

  /* An empty string stands for "nobody is queued": a real token is always a uuid. */
  const headToken = (): string => {
    let head = "";
    let earliest = Number.POSITIVE_INFINITY;
    for (const [token, arrivalMs] of arrivalByToken) {
      if (arrivalMs < earliest) {
        earliest = arrivalMs;
        head = token;
      }
    }
    return head;
  };

  const evaluate = (
    _script: string,
    _numberOfKeys: number,
    ...arguments_: string[]
  ): Promise<unknown> => {
    /* Anything shorter than the window arguments is the queue-departure call. */
    if (arguments_.length < WINDOW_ARGUMENT_COUNT) {
      arrivalByToken.delete(String(arguments_[1]));
      return Promise.resolve(1);
    }

    const count = Number(arguments_[3]);
    const occupancyBefore = occupancy;
    const hasRoom = occupancy + count <= LIMIT;
    const token = arguments_[TOKEN_ARGUMENT_INDEX] ?? "";

    if (token === "") {
      if (hasRoom) {
        occupancy += count;
        return Promise.resolve([0, occupancyBefore]);
      }
      return Promise.resolve([RETRY_HINT_MS, occupancyBefore]);
    }

    const nowMs = Number(arguments_[2]);
    purgeExpired(nowMs, Number(arguments_[TTL_ARGUMENT_INDEX]));

    const head = headToken();
    if (hasRoom && (head === "" || head === token)) {
      occupancy += count;
      arrivalByToken.delete(token);
      return Promise.resolve([0, occupancyBefore, arrivalByToken.size]);
    }

    if (!arrivalByToken.has(token)) {
      arrivalByToken.set(token, nowMs);
      onJoin?.(token);
    }
    return Promise.resolve([RETRY_HINT_MS, occupancyBefore, arrivalByToken.size]);
  };

  return {
    eval: evaluate,
    queuedTokens: () => [...arrivalByToken.keys()],
    release: (slots: number) => {
      occupancy -= slots;
    },
    seedAbandonedEntry: (token: string) => {
      arrivalByToken.set(token, Date.now());
    },
  };
};

const settle = async (durationMs: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(durationMs);
  await vi.advanceTimersByTimeAsync(0);
};

const step = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, READINESS_STEP_MS);
  });

/* A readiness gate, not a timing assertion: it only decides when the next act may run. */
const waitUntil = async (isReady: () => boolean, description: string): Promise<void> => {
  for (let attempt = 0; attempt < READINESS_ATTEMPTS; attempt += 1) {
    if (isReady()) {
      return;
    }
    await step();
  }
  throw new Error(`the limiter never reached this state: ${description}`);
};

describe("an abandoned waiter cannot wedge the queue", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("grants a live waiter once a dead process's entry ages past the ttl", async () => {
    vi.useFakeTimers();
    const redis = createQueueRedis();
    redis.seedAbandonedEntry("entry-of-a-process-that-died");
    const limiter = createRedisRateLimiter(redis, "ratelimit:caldav-account:fastmail", {
      requestsPerMinute: LIMIT,
    });

    let granted = false;
    const park = async (): Promise<void> => {
      await limiter.acquire(1);
      granted = true;
    };
    const acquiring = park();

    redis.release(1);
    await settle(SETTLED_POLLS_MS);

    expect(granted).toBe(false);
    expect(redis.queuedTokens()).toContain("entry-of-a-process-that-died");

    await settle(BEYOND_ANY_TTL_MS);

    expect(granted).toBe(true);
    expect(redis.queuedTokens()).toEqual([]);
    await acquiring;
  });

  it("drops an aborting caller's entry while still rejecting with the signal reason", async () => {
    const controller = new AbortController();
    const deadlineReason = new Error("ingest deadline reached");
    let abandonedToken = "";
    const redis = createQueueRedis((token) => {
      if (abandonedToken === "") {
        abandonedToken = token;
      }
    });
    const limiter = createRedisRateLimiter(redis, "ratelimit:caldav-account:fastmail", {
      requestsPerMinute: LIMIT,
    });

    const abandoned = limiter.acquire(1, controller.signal);
    await waitUntil(() => abandonedToken !== "", "the aborting caller joined the queue");

    let followerGranted = false;
    const park = async (): Promise<void> => {
      await limiter.acquire(1);
      followerGranted = true;
    };
    const follower = park();
    await waitUntil(
      () => redis.queuedTokens().length > 1,
      "a follower parked behind the aborting caller",
    );

    controller.abort(deadlineReason);
    await expect(abandoned).rejects.toBe(deadlineReason);
    expect(isIngestPacingParkAbortError(deadlineReason)).toBe(true);
    expect(redis.queuedTokens()).not.toContain(abandonedToken);

    redis.release(1);
    await waitUntil(() => followerGranted, "the follower was granted after the abort");
    await follower;
  });
});
