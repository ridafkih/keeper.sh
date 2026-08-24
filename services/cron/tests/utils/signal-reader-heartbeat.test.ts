import { describe, expect, it, vi } from "vitest";
import {
  describeSignalReader,
  HEARTBEAT_TTL_SECONDS,
  recordSignalReaderHeartbeat,
} from "../../src/utils/signal-reader-heartbeat";

const fakeRedis = () => {
  const store = new Map<string, string>();
  return {
    get: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setex: vi.fn((key: string, _seconds: number, value: string) => {
      store.set(key, value);
      return Promise.resolve("OK");
    }),
    store,
  };
};

describe("reporting whether the signal reader is alive", () => {
  it("reads as not running before any reader has beaten", async () => {
    await expect(describeSignalReader(fakeRedis())).resolves.toEqual({ reads: 0, running: false });
  });

  it("reads as running once a reader beats, carrying its read count", async () => {
    const redis = fakeRedis();

    await recordSignalReaderHeartbeat(redis, 7);

    await expect(describeSignalReader(redis)).resolves.toEqual({ reads: 7, running: true });
  });

  it("survives the process boundary, which a variable in memory does not", async () => {
    const shared = fakeRedis();
    await recordSignalReaderHeartbeat(shared, 3);

    const otherProcess = { get: (key: string) => Promise.resolve(shared.store.get(key) ?? null) };

    await expect(describeSignalReader(otherProcess)).resolves.toEqual({ reads: 3, running: true });
  });

  it("expires, so a reader that dies stops reading as alive", async () => {
    const redis = fakeRedis();

    await recordSignalReaderHeartbeat(redis, 1);

    expect(redis.setex.mock.calls[0]?.[1]).toBe(HEARTBEAT_TTL_SECONDS);
    expect(HEARTBEAT_TTL_SECONDS).toBeGreaterThan(5);
  });

  it("never lets a redis failure take down the reader that is beating", async () => {
    const broken = { setex: () => Promise.reject(new Error("redis down")) };

    await expect(recordSignalReaderHeartbeat(broken, 1)).resolves.toBeUndefined();
  });

  it("treats an unreadable heartbeat as not running rather than throwing", async () => {
    const broken = { get: () => Promise.reject(new Error("redis down")) };

    await expect(describeSignalReader(broken)).resolves.toEqual({ reads: 0, running: false });
  });
});
