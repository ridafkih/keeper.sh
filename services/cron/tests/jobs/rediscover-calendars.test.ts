import { describe, expect, it, vi } from "vitest";

vi.mock("@/context", () => ({
  database: {},
  premiumService: {},
  refreshLockRedis: {},
  refreshLockStore: { tryAcquire: () => Promise.resolve(true), release: () => Promise.resolve() },
}));

vi.mock("@/env", () => ({
  default: {
    CALENDAR_REDISCOVERY_ENABLED: true,
    DATABASE_URL: "postgres://unused",
    REDIS_URL: "redis://unused",
  },
  schema: {},
}));

const COLD_IMPORT_TIMEOUT_MS = 30_000;

describe("rediscover-calendars job registration", () => {
  it("registers as a cron job the auto-discovery glob will accept", async () => {
    const module = await import("../../src/jobs/rediscover-calendars");
    const job = module.default;

    expect(typeof job.callback).toBe("function");
    expect(typeof job.name).toBe("string");
    expect(job.name).toBe("rediscover-calendars");
  }, COLD_IMPORT_TIMEOUT_MS);

  it("does not stampede providers on boot and never overlaps itself", async () => {
    const module = await import("../../src/jobs/rediscover-calendars");
    const job = module.default;

    expect(job.immediate).toBe(false);
    expect(job.overrunProtection).toBe(true);
  }, COLD_IMPORT_TIMEOUT_MS);
});
