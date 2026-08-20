import { describe, expect, it } from "vitest";
import {
  PENDING_SIGNAL_MAX_LENGTH,
  signalPendingCalendars,
} from "../../../src/core/source/pending-signal";

const fakeRedis = () => {
  const lists = new Map<string, string[]>();
  let ttlSeconds: number | null = null;
  return {
    expire: (key: string, seconds: number) => {
      ttlSeconds = seconds;
      return Promise.resolve(1);
    },
    lists,
    ltrim: (key: string, start: number, stop: number) => {
      const list = lists.get(key) ?? [];
      const resolveIndex = (index: number): number => {
        if (index < 0) {
          return Math.max(list.length + index, 0);
        }
        return index;
      };
      lists.set(key, list.slice(resolveIndex(start), resolveIndex(stop) + 1));
      return Promise.resolve("OK");
    },
    rpush: (key: string, ...values: string[]) => {
      const list = lists.get(key) ?? [];
      list.push(...values);
      lists.set(key, list);
      return Promise.resolve(list.length);
    },
    ttl: () => ttlSeconds,
  };
};

const onlyList = (redis: ReturnType<typeof fakeRedis>): string[] =>
  [...redis.lists.values()][0] ?? [];

describe("signalling calendars for an immediate drain", () => {
  it("records the calendars it was given", async () => {
    const redis = fakeRedis();

    await signalPendingCalendars(redis, ["one", "two"]);

    expect(onlyList(redis)).toEqual(["one", "two"]);
  });

  it("cannot grow past its bound when nothing is reading", async () => {
    const redis = fakeRedis();

    for (let batch = 0; batch < 30; batch++) {
      await signalPendingCalendars(
        redis,
        Array.from({ length: 500 }, (_unused, index) => `calendar-${batch}-${index}`),
      );
    }

    expect(onlyList(redis)).toHaveLength(PENDING_SIGNAL_MAX_LENGTH);
  });

  it("keeps the newest signals, the ones least likely to be drained already", async () => {
    const redis = fakeRedis();

    await signalPendingCalendars(
      redis,
      Array.from({ length: PENDING_SIGNAL_MAX_LENGTH + 2 }, (_unused, index) => `calendar-${index}`),
    );

    expect(onlyList(redis).at(-1)).toBe(`calendar-${PENDING_SIGNAL_MAX_LENGTH + 1}`);
    expect(onlyList(redis)).not.toContain("calendar-0");
  });

  it("expires, so a reader that never returns leaves nothing behind", async () => {
    const redis = fakeRedis();

    await signalPendingCalendars(redis, ["one"]);

    expect(redis.ttl()).toBeGreaterThan(0);
  });

  it("writes nothing when a delivery woke no calendar", async () => {
    const redis = fakeRedis();

    await signalPendingCalendars(redis, []);

    expect(redis.lists.size).toBe(0);
  });
});
