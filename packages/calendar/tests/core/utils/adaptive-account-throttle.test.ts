import { describe, expect, it } from "vitest";
import type { AccountThrottlePolicy } from "@keeper.sh/constants";
import {
  AccountThrottledError,
  createAdaptiveAccountLimiter,
  nextThrottleState,
  resolveEffectiveLevel,
  resolveRequestsPerMinute,
} from "../../../src/core/utils/adaptive-account-throttle";
import type { RedisScriptClient } from "../../../src/core/utils/redis-rate-limiter";

const POLICY: AccountThrottlePolicy = {
  initialCooldownMs: 30_000,
  jitterRatio: 0.2,
  maximumCooldownMs: 900_000,
  maximumParkMs: 15_000,
  minimumRequestsPerMinute: 15,
  recoveryWindowMs: 600_000,
  requestsPerMinute: 240,
};

const NO_JITTER = (): number => 0;

interface FakeRedis extends RedisScriptClient {
  acquireLimits: number[];
  values: Map<string, string>;
}

const createFakeRedis = (): FakeRedis => {
  const values = new Map<string, string>();
  const acquireLimits: number[] = [];
  return {
    acquireLimits,
    eval: (script: string, _keys: number, ...args: string[]) => {
      const [key = ""] = args;
      if (script.includes("'GET'") && !script.includes("'SET'")) {
        return Promise.resolve(values.get(key) ?? null);
      }
      if (script.includes("'SET'")) {
        const [, value = "", cooldownUntil = "0"] = args;
        const existing = values.get(key);
        if (existing && Number(JSON.parse(existing).cooldownUntil) > Number(cooldownUntil)) {
          return Promise.resolve(0);
        }
        values.set(key, value);
        return Promise.resolve(1);
      }
      acquireLimits.push(Number(args[4]));
      return Promise.resolve([0, 0]);
    },
    values,
  };
};

const createClock = (start: number) => {
  let current = start;
  return {
    advance: (milliseconds: number) => {
      current += milliseconds;
    },
    now: () => current,
  };
};

describe("the adaptive per-account throttle policy", () => {
  it("halves the account's pace for each throttle level down to the floor", () => {
    expect(resolveRequestsPerMinute(0, POLICY)).toBe(240);
    expect(resolveRequestsPerMinute(1, POLICY)).toBe(120);
    expect(resolveRequestsPerMinute(3, POLICY)).toBe(30);
    expect(resolveRequestsPerMinute(10, POLICY)).toBe(15);
  });

  it("cools down for at least the server's Retry-After", () => {
    const state = nextThrottleState({ cooldownUntil: 0, lastThrottleAt: 0, level: 0 }, 120_000, 1000, POLICY, NO_JITTER);

    expect(state).toEqual({ cooldownUntil: 121_000, lastThrottleAt: 1000, level: 1 });
  });

  it("backs off exponentially when the server names no retry interval", () => {
    const first = nextThrottleState({ cooldownUntil: 0, lastThrottleAt: 0, level: 0 }, null, 0, POLICY, NO_JITTER);
    const second = nextThrottleState(first, null, 40_000, POLICY, NO_JITTER);
    const third = nextThrottleState(second, null, 120_000, POLICY, NO_JITTER);

    expect(first.cooldownUntil).toBe(30_000);
    expect(second.cooldownUntil - 40_000).toBe(60_000);
    expect(third.cooldownUntil - 120_000).toBe(120_000);
  });

  it("never cools down past the configured ceiling", () => {
    const state = nextThrottleState({ cooldownUntil: 0, lastThrottleAt: 0, level: 9 }, null, 0, POLICY, NO_JITTER);

    expect(state.cooldownUntil).toBe(POLICY.maximumCooldownMs);
  });

  it("forgives one throttle level per quiet recovery window", () => {
    const state = { cooldownUntil: 30_000, lastThrottleAt: 0, level: 3 };

    expect(resolveEffectiveLevel(state, POLICY.recoveryWindowMs - 1, POLICY)).toBe(3);
    expect(resolveEffectiveLevel(state, POLICY.recoveryWindowMs * 2, POLICY)).toBe(1);
    expect(resolveEffectiveLevel(state, POLICY.recoveryWindowMs * 10, POLICY)).toBe(0);
  });
});

describe("an account limiter shared by every job touching the account", () => {
  it("refuses requests outright while the account cools down past the park limit", async () => {
    const redis = createFakeRedis();
    const clock = createClock(1_000_000);
    const limiter = createAdaptiveAccountLimiter(redis, "ratelimit:caldav-account:a", POLICY, {
      now: clock.now,
      random: NO_JITTER,
    });

    await limiter.reportThrottle(null);

    await expect(limiter.acquire(1)).rejects.toBeInstanceOf(AccountThrottledError);
    expect(redis.acquireLimits).toEqual([]);
  });

  it("sees a throttle another job reported for the same account", async () => {
    const redis = createFakeRedis();
    const clock = createClock(1_000_000);
    const options = { now: clock.now, random: NO_JITTER };
    const pushLimiter = createAdaptiveAccountLimiter(redis, "ratelimit:caldav-account:a", POLICY, options);
    const ingestLimiter = createAdaptiveAccountLimiter(redis, "ratelimit:caldav-account:a", POLICY, options);
    const otherAccount = createAdaptiveAccountLimiter(redis, "ratelimit:caldav-account:b", POLICY, options);

    await pushLimiter.reportThrottle(null);

    await expect(ingestLimiter.acquire(1)).rejects.toBeInstanceOf(AccountThrottledError);
    await expect(otherAccount.acquire(1)).resolves.toBeUndefined();
  });

  it("parks a request through a short cooldown, then sends it at the reduced pace", async () => {
    const redis = createFakeRedis();
    const clock = createClock(1_000_000);
    const parks: number[] = [];
    const limiter = createAdaptiveAccountLimiter(redis, "ratelimit:caldav-account:a", POLICY, {
      now: clock.now,
      random: NO_JITTER,
      sleep: (milliseconds) => {
        parks.push(milliseconds);
        clock.advance(milliseconds);
        return Promise.resolve();
      },
    });

    await limiter.reportThrottle(null);
    clock.advance(20_000);
    await limiter.acquire(1);

    expect(parks).toEqual([10_000]);
    expect(redis.acquireLimits).toEqual([120]);
  });

  it("counts a burst of throttled responses already in flight as one throttle", async () => {
    const redis = createFakeRedis();
    const clock = createClock(1_000_000);
    const limiter = createAdaptiveAccountLimiter(redis, "ratelimit:caldav-account:a", POLICY, {
      now: clock.now,
      random: NO_JITTER,
    });

    await limiter.reportThrottle(null);
    await limiter.reportThrottle(null);
    await limiter.reportThrottle(null);
    clock.advance(POLICY.initialCooldownMs);
    await limiter.acquire(1);

    expect(redis.acquireLimits).toEqual([120]);
  });

  it("returns to full pace once the account has been quiet long enough", async () => {
    const redis = createFakeRedis();
    const clock = createClock(1_000_000);
    const limiter = createAdaptiveAccountLimiter(redis, "ratelimit:caldav-account:a", POLICY, {
      now: clock.now,
      random: NO_JITTER,
    });

    await limiter.reportThrottle(null);
    clock.advance(POLICY.recoveryWindowMs);
    await limiter.acquire(1);

    expect(redis.acquireLimits).toEqual([240]);
  });
});
