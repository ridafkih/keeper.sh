import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/env", () => ({ default: { ENCRYPTION_KEY: "test-key" } }));
vi.mock("../../src/context", () => ({
  flushDrainRegistry: { register: (): null => null },
  database: { select: () => ({}), update: () => ({}) },
  premiumService: { getUserPlan: () => Promise.resolve("pro") },
  refreshLockRedis: { eval: () => Promise.resolve(null), get: () => Promise.resolve(null) },
  refreshLockStore: { release: () => Promise.resolve(), tryAcquire: () => Promise.resolve(true) },
}));
vi.mock("../../src/utils/logging", () => ({
  context: (callback: () => unknown) => callback(),
  widelog: {
    errorFields: () => null,
    set: () => null,
    setFields: () => null,
    time: { measure: (_key: string, callback: () => unknown) => callback() },
  },
}));

const { startPendingSignalReader } = await import("../../src/utils/start-pending-signal-reader");

/*
 * A dropped connection rejects the command still in flight, and shutdown waits on exactly
 * that, so a double whose read never settles would hang for a reason production has not.
 */
const blockingRedisDouble = () => {
  const pendingReads: ((error: Error) => void)[] = [];
  return {
    blpop: vi.fn(() => new Promise<null>((_resolve, reject) => {
      pendingReads.push(reject);
    })),
    disconnect: vi.fn(() => {
      for (const failRead of pendingReads) {
        failRead(new Error("Connection is closed."));
      }
    }),
  };
};

const scoreRedis = {
  del: (...keys: string[]) => Promise.resolve(keys.length),
  hmget: () => Promise.resolve([]),
  hsetnx: () => Promise.resolve(0),
  set: () => Promise.resolve("OK"),
  zscore: () => Promise.resolve(null),
};
const heartbeatRedis = { setex: () => Promise.resolve("OK") };

describe("starting the signal reader", () => {
  it("does not read when push is unconfigured, so no connection is held open", () => {
    const blockingRedis = blockingRedisDouble();

    const reader = startPendingSignalReader({ blockingRedis, enabled: false, heartbeatRedis, scoreRedis });

    expect(reader).toBeNull();
    expect(blockingRedis.blpop).not.toHaveBeenCalled();
  });

  it("begins reading as soon as push is configured", async () => {
    const blockingRedis = blockingRedisDouble();

    const reader = startPendingSignalReader({ blockingRedis, enabled: true, heartbeatRedis, scoreRedis });
    await Promise.resolve();

    expect(reader).not.toBeNull();
    expect(blockingRedis.blpop).toHaveBeenCalled();
  });

  it("closes its connection when the process shuts down", async () => {
    const blockingRedis = blockingRedisDouble();
    const reader = startPendingSignalReader({ blockingRedis, enabled: true, heartbeatRedis, scoreRedis });
    await Promise.resolve();

    await reader?.stop();

    expect(blockingRedis.disconnect).toHaveBeenCalled();
  });
});
