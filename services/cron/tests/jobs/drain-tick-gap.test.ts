import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CronOptions } from "cronbake";

const fields = new Map<string, unknown>();
const environment: { WEBHOOK_PUBLIC_URL?: string } = {};

let drainJob: CronOptions = {
  callback: () => Promise.reject(new Error("Module not loaded")),
  cron: "",
  name: "",
};

vi.mock("../../src/env", () => ({ default: environment }));
const lockControl = { acquires: true };
const drainControl = { bodyDurationMs: 0 };

vi.mock("../../src/context", () => ({
  flushDrainRegistry: { register: (): null => null },
  inFlightDrainRegistry: {
    register: (): null => null,
    settle: (): Promise<void> => Promise.resolve(),
  },
  database: { select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }) },
  premiumService: { getUserPlan: () => Promise.resolve("pro") },
  refreshLockRedis: {
    get: (): Promise<null> => Promise.resolve(null),
    eval: () => Promise.resolve([]),
    hdel: () => Promise.resolve(0),
    hincrby: () => Promise.resolve(1),
    zcard: async () => {
      await Bun.sleep(drainControl.bodyDurationMs);
      return 0;
    },
    zrange: () => Promise.resolve([]),
    zrem: () => Promise.resolve(0),
  },
  refreshLockStore: {
    release: () => Promise.resolve(),
    tryAcquire: () => Promise.resolve(lockControl.acquires),
  },
}));
vi.mock("../../src/utils/logging", () => ({
  context: (callback: () => unknown) => callback(),
  widelog: {
    append: () => null,
    count: () => null,
    error: () => null,
    errorFields: () => null,
    flush: () => null,
    max: () => null,
    min: () => null,
    set: (key: string, value: unknown) => {
      fields.set(key, value);
    },
    setFields: () => null,
    time: { measure: (_key: string, callback: () => unknown) => callback() },
  },
}));
vi.mock("../../src/jobs/ingest-sources", () => ({
  ingestOAuthSources: () => Promise.resolve({ affectedUserIds: [] }),
}));
vi.mock("../../src/utils/enqueue-destination-syncs", () => ({
  enqueueDestinationSyncsForUsers: () => Promise.resolve(0),
}));

const SUPPRESSED_TICK_MS = 40;
const SLOW_DRAIN_BODY_MS = 60;

/*
 * Bun.sleep can return a fraction of a millisecond before the span measuring it elapses, so
 * an exact floor makes these assertions report timer granularity rather than attribution.
 * The slack is far smaller than any injected delay, so a segment charged to the wrong bucket
 * still fails.
 */
const TIMER_SLACK_MS = 5;

const chargedAtLeast = (injectedMs: number): number => injectedMs - TIMER_SLACK_MS;


beforeAll(async () => {
  ({ default: drainJob } = await import("../../src/jobs/drain-pending-ingest"));
});

beforeEach(() => {
  fields.clear();
  environment.WEBHOOK_PUBLIC_URL = "https://webhooks.example";
  lockControl.acquires = true;
  drainControl.bodyDurationMs = 0;
});

describe("drain tick gap", () => {
  it("says nothing about a gap on the first tick of the process", async () => {
    await drainJob.callback();

    expect(fields.get("push_drain.tick_gap_ms")).toBeUndefined();
  });

  it("converts ticks lost to overrun protection into a gap on the next surviving tick", async () => {
    await drainJob.callback();
    await Bun.sleep(SUPPRESSED_TICK_MS);
    await drainJob.callback();

    expect(fields.get("push_drain.tick_gap_ms")).toBeGreaterThanOrEqual(chargedAtLeast(SUPPRESSED_TICK_MS));
  });

  it("counts the overrunning tick's own runtime, not the idle time after it", async () => {
    drainControl.bodyDurationMs = SLOW_DRAIN_BODY_MS;
    await drainJob.callback();
    drainControl.bodyDurationMs = 0;
    await Bun.sleep(SUPPRESSED_TICK_MS);
    await drainJob.callback();

    expect(fields.get("push_drain.tick_gap_ms"))
      .toBeGreaterThanOrEqual(chargedAtLeast(SLOW_DRAIN_BODY_MS + SUPPRESSED_TICK_MS));
  });

  it("does not roll a lock-contended tick into the next tick's gap", async () => {
    await drainJob.callback();
    lockControl.acquires = false;
    await Bun.sleep(SUPPRESSED_TICK_MS);
    await drainJob.callback();

    expect(fields.get("push_drain.lock_contention")).toBe(1);
    lockControl.acquires = true;
    fields.clear();
    await drainJob.callback();

    expect(fields.get("push_drain.tick_gap_ms")).toBeLessThan(SUPPRESSED_TICK_MS);
  });
});
