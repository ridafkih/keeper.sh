import { describe, expect, it } from "vitest";
import { resolveJobAllowanceMs, resolveJobIntervalMs } from "../../src/utils/job-allowance";

const MINUTE_MS = 60_000;

describe("resolveJobIntervalMs", () => {
  it("reads the interval from an every-N preset", () => {
    expect(resolveJobIntervalMs("@every_1_minutes")).toBe(MINUTE_MS);
    expect(resolveJobIntervalMs("@every_30_minutes")).toBe(30 * MINUTE_MS);
    expect(resolveJobIntervalMs("@every_45_seconds")).toBe(45_000);
    expect(resolveJobIntervalMs("@every_2_hours")).toBe(120 * MINUTE_MS);
  });

  it("gives no interval for schedules it cannot be sure of", () => {
    for (const schedule of [
      "@daily",
      "@every_minute",
      "@every_0_minutes",
      "@every_1_months",
      "@every_1.5_minutes",
      "*/5 * * * * *",
      "@at_12:30",
      "",
    ]) {
      expect(resolveJobIntervalMs(schedule), schedule).toBeNull();
    }
  });
});

describe("resolveJobAllowanceMs", () => {
  it("never allows less than fifteen minutes", () => {
    expect(resolveJobAllowanceMs("@every_1_minutes")).toBe(15 * MINUTE_MS);
    expect(resolveJobAllowanceMs("@every_5_minutes")).toBe(15 * MINUTE_MS);
    expect(resolveJobAllowanceMs("@every_10_seconds")).toBe(15 * MINUTE_MS);
  });

  it("allows three missed runs for slower schedules", () => {
    expect(resolveJobAllowanceMs("@every_15_minutes")).toBe(45 * MINUTE_MS);
    expect(resolveJobAllowanceMs("@every_30_minutes")).toBe(90 * MINUTE_MS);
  });

  it("gives no allowance when there is no interval to measure against", () => {
    expect(resolveJobAllowanceMs("@daily")).toBeNull();
  });

  it("covers every schedule the shipped jobs use", async () => {
    const { Glob } = await import("bun");
    const sources = await Promise.all(
      [...new Glob("src/jobs/*.ts").scanSync(`${import.meta.dirname}/../..`)]
        .map((file) => Bun.file(`${import.meta.dirname}/../../${file}`).text()),
    );
    const schedules = sources.flatMap((source) => source.match(/@every_[a-z0-9_]+/g) ?? []);

    expect(schedules.length).toBeGreaterThan(0);
    for (const schedule of schedules) {
      expect(resolveJobAllowanceMs(schedule), schedule).not.toBeNull();
    }
  });
});
