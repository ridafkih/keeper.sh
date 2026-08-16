import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CronOptions } from "cronbake";

const COLD_IMPORT_TIMEOUT_MS = 30_000;

const flushes: number[] = [];
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
    error: () => null,
    errorFields: () => null,
    flush: () => {
      flushes.push(1);
    },
    set: () => null,
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

beforeAll(async () => {
  ({ default: drainJob } = await import("../../src/jobs/drain-pending-ingest"));
}, COLD_IMPORT_TIMEOUT_MS);

beforeEach(() => {
  flushes.length = 0;
  delete environment.WEBHOOK_PUBLIC_URL;
});

describe("the drain job on an unconfigured deployment", () => {
  it("emits no wide event at all", async () => {
    await drainJob.callback();

    expect(flushes).toEqual([]);
  });

  it("keeps its ten second schedule so enabling the URL needs no redeploy", () => {
    expect(drainJob.cron).toBe("*/10 * * * * *");
    expect(drainJob.overrunProtection).toBe(true);
  });
});

describe("the drain job on a configured deployment", () => {
  it("emits exactly one wide event per tick", async () => {
    environment.WEBHOOK_PUBLIC_URL = "https://www.example.com";

    await drainJob.callback();

    expect(flushes).toHaveLength(1);
  });
});
