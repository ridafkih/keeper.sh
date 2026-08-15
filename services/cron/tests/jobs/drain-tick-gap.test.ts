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
vi.mock("../../src/context", () => ({
  database: { select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }) },
  premiumService: { getUserPlan: () => Promise.resolve("pro") },
  refreshLockRedis: {
    eval: () => Promise.resolve([]),
    hdel: () => Promise.resolve(0),
    hincrby: () => Promise.resolve(1),
    zcard: () => Promise.resolve(0),
    zrange: () => Promise.resolve([]),
    zrem: () => Promise.resolve(0),
  },
  refreshLockStore: { release: () => Promise.resolve(), tryAcquire: () => Promise.resolve(true) },
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

beforeAll(async () => {
  ({ default: drainJob } = await import("../../src/jobs/drain-pending-ingest"));
});

beforeEach(() => {
  fields.clear();
  environment.WEBHOOK_PUBLIC_URL = "https://webhooks.example";
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

    expect(fields.get("push_drain.tick_gap_ms")).toBeGreaterThanOrEqual(SUPPRESSED_TICK_MS);
  });
});
