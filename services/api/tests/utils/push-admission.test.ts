import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PUSH_ADMISSION_BUCKET_MS,
  PUSH_ADMISSION_PER_BUCKET,
  PUSH_CHANNEL_ADMISSION_PER_BUCKET,
  claimPushAdmission,
} from "../../src/utils/push-admission";

const createCountingRedis = () => {
  const counters = new Map<string, number>();
  const expiries = new Map<string, number>();

  return {
    counters,
    expire: (key: string, seconds: number): Promise<number> => {
      expiries.set(key, seconds);
      return Promise.resolve(1);
    },
    expiries,
    incr: (key: string): Promise<number> => {
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return Promise.resolve(next);
    },
  };
};

describe("claimPushAdmission provider budget", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("admits up to the per-bucket budget and sheds the next request", async () => {
    const redis = createCountingRedis();

    for (let index = 0; index < PUSH_ADMISSION_PER_BUCKET; index++) {
      await expect(claimPushAdmission(redis, {
        channelKey: null,
        provider: "google",
      })).resolves.toBe(true);
    }

    await expect(claimPushAdmission(redis, {
      channelKey: null,
      provider: "google",
    })).resolves.toBe(false);
  });

  it("resets once the bucket boundary passes", async () => {
    const redis = createCountingRedis();

    for (let index = 0; index < PUSH_ADMISSION_PER_BUCKET; index++) {
      await claimPushAdmission(redis, { channelKey: null, provider: "google" });
    }
    await expect(claimPushAdmission(redis, {
      channelKey: null,
      provider: "google",
    })).resolves.toBe(false);

    vi.advanceTimersByTime(PUSH_ADMISSION_BUCKET_MS);

    await expect(claimPushAdmission(redis, {
      channelKey: null,
      provider: "google",
    })).resolves.toBe(true);
  });

  it("keeps providers on separate budgets", async () => {
    const redis = createCountingRedis();

    for (let index = 0; index < PUSH_ADMISSION_PER_BUCKET; index++) {
      await claimPushAdmission(redis, { channelKey: null, provider: "google" });
    }

    await expect(claimPushAdmission(redis, {
      channelKey: null,
      provider: "outlook",
    })).resolves.toBe(true);
  });

  it("costs a single counter so it can run before the body is read", async () => {
    const redis = createCountingRedis();

    await claimPushAdmission(redis, { channelKey: null, provider: "google" });

    expect(redis.counters.size).toBe(1);
  });
});

describe("claimPushAdmission channel budget", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the per-channel budget independent of the global one", async () => {
    const redis = createCountingRedis();

    for (let index = 0; index < PUSH_CHANNEL_ADMISSION_PER_BUCKET; index++) {
      await expect(claimPushAdmission(redis, {
        channelKey: "noisy-channel",
        provider: "google",
      })).resolves.toBe(true);
    }

    await expect(claimPushAdmission(redis, {
      channelKey: "noisy-channel",
      provider: "google",
    })).resolves.toBe(false);
    await expect(claimPushAdmission(redis, {
      channelKey: "quiet-channel",
      provider: "google",
    })).resolves.toBe(true);
  });

  it("never counts a channel against the provider bucket twice", async () => {
    const redis = createCountingRedis();

    await claimPushAdmission(redis, { channelKey: "channel-1", provider: "google" });

    expect([...redis.counters.keys()]).toEqual([
      `push:admit:google:channel-1:${Math.floor(Date.now() / PUSH_ADMISSION_BUCKET_MS)}`,
    ]);
  });

  it("expires its counters rather than leaking keys", async () => {
    const redis = createCountingRedis();

    await claimPushAdmission(redis, { channelKey: null, provider: "google" });
    await claimPushAdmission(redis, { channelKey: "channel-1", provider: "google" });

    expect(redis.expiries.size).toBe(2);
    for (const seconds of redis.expiries.values()) {
      expect(seconds).toBeGreaterThan(0);
      expect(seconds).toBeLessThanOrEqual((PUSH_ADMISSION_BUCKET_MS / 1000) * 3);
    }
  });

  it("never waits on a timer for a slot to free", async () => {
    const redis = createCountingRedis();

    for (let index = 0; index < PUSH_ADMISSION_PER_BUCKET + 5; index++) {
      await claimPushAdmission(redis, { channelKey: null, provider: "google" });
    }

    expect(vi.getTimerCount()).toBe(0);
  });
});
