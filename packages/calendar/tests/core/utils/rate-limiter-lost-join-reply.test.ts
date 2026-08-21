import { afterEach, describe, expect, it, vi } from "vitest";
import { createRedisRateLimiter } from "../../../src/core/utils/redis-rate-limiter";

const LIMIT = 2;
const WINDOW_ARGUMENT_COUNT = 5;
const TOKEN_ARGUMENT_INDEX = 5;
const TTL_ARGUMENT_INDEX = 6;
const RETRY_HINT_MS = 50;
const SETTLED_POLLS_MS = 2000;

interface LostReplyRedis {
  eval(script: string, numberOfKeys: number, ...arguments_: string[]): Promise<unknown>;
  queuedTokens(): string[];
  release(slots: number): void;
}

/*
 * Stands in for the acquire script against a server that runs the script and then loses
 * the reply — the connection torn down under a dying process or an aborting caller. The
 * first waiter to join is answered with a connection error AFTER its entry is recorded,
 * which is what redis really leaves behind when a reply never arrives.
 */
const createLostReplyRedis = (): LostReplyRedis => {
  let occupancy = LIMIT;
  let replyAlreadyLost = false;
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

    const alreadyQueued = arrivalByToken.has(token);
    if (!alreadyQueued) {
      arrivalByToken.set(token, nowMs);
    }
    if (!alreadyQueued && !replyAlreadyLost) {
      replyAlreadyLost = true;
      return Promise.reject(new Error("Connection is closed."));
    }
    return Promise.resolve([RETRY_HINT_MS, occupancyBefore, arrivalByToken.size]);
  };

  return {
    eval: evaluate,
    queuedTokens: () => [...arrivalByToken.keys()],
    release: (slots: number) => {
      occupancy -= slots;
    },
  };
};

const settle = async (durationMs: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(durationMs);
  await vi.advanceTimersByTimeAsync(0);
};

describe("an abandoned waiter cannot wedge the queue", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("removes its own entry when the reply to its queue join never arrives", async () => {
    vi.useFakeTimers();
    const redis = createLostReplyRedis();
    const limiter = createRedisRateLimiter(redis, "ratelimit:caldav-account:fastmail", {
      requestsPerMinute: LIMIT,
    });

    const failing = limiter.acquire(1).catch((error: unknown) => error);
    await settle(SETTLED_POLLS_MS);
    const outcome = await failing;

    expect(outcome).toBeInstanceOf(Error);
    expect(redis.queuedTokens()).toEqual([]);
  });

  it("grants the follower behind a lost-reply join without waiting out the ttl", async () => {
    vi.useFakeTimers();
    const redis = createLostReplyRedis();
    const limiter = createRedisRateLimiter(redis, "ratelimit:caldav-account:fastmail", {
      requestsPerMinute: LIMIT,
    });

    const failing = limiter.acquire(1).catch((error: unknown) => error);
    await settle(SETTLED_POLLS_MS);
    await failing;

    let followerGranted = false;
    const park = async (): Promise<void> => {
      await limiter.acquire(1);
      followerGranted = true;
    };
    const follower = park();
    await settle(SETTLED_POLLS_MS);

    redis.release(1);
    await settle(SETTLED_POLLS_MS);

    expect(followerGranted).toBe(true);
    await follower;
  });
});
