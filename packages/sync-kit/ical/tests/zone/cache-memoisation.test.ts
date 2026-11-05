import { describe, expect, test } from "vitest";
import { buildVtimezone, createZoneCache, resolveWallTime, zoneCacheStatistics } from "../../src/index";
import type { VtimezoneBlock } from "../../src/index";
import { testOptions } from "../support/options";

const berlin = { kind: "zoneId", value: "Europe/Berlin" } as const;

const textOf = (block: VtimezoneBlock): string => {
  if (block.kind === "unresolvableZone") {
    return "";
  }
  return block.text;
};

describe("the injected zone cache", () => {
  test("ICAL-L9: a second projection for the same zone and reference year does no further Intl work", () => {
    const options = testOptions();
    buildVtimezone(berlin, 2026, options);
    const afterFirst = zoneCacheStatistics(options.zones).formatterConstructions;
    buildVtimezone(berlin, 2026, options);

    expect(zoneCacheStatistics(options.zones).formatterConstructions).toBe(afterFirst);
    expect(afterFirst).toBeGreaterThan(0);
  });

  test("ICAL-L9: a different reference year is a different memo entry, not a stale hit", () => {
    const options = testOptions();
    const current = buildVtimezone(berlin, 2026, options);
    const historic = buildVtimezone(berlin, 1996, options);

    expect(textOf(historic)).not.toBe(textOf(current));
    expect(textOf(historic)).toContain("1996");
  });

  test("ICAL-L9: the weekday formatter is memoised too, so a second projection builds none", () => {
    const options = testOptions();
    buildVtimezone(berlin, 2026, options);
    const afterFirst = zoneCacheStatistics(options.zones).formatterConstructions;
    buildVtimezone(berlin, 1996, options);

    expect(zoneCacheStatistics(options.zones).formatterConstructions).toBe(afterFirst);
  });

  test("ICAL-L9: the formatter for a zone is constructed once across many wall-time resolutions", () => {
    const zones = createZoneCache();
    resolveWallTime({ kind: "wallTime", value: "20260615T120000" }, berlin, zones);
    const afterFirst = zoneCacheStatistics(zones).formatterConstructions;
    for (let index = 0; index < 100; index++) {
      resolveWallTime({ kind: "wallTime", value: "20260615T120000" }, berlin, zones);
    }

    expect(zoneCacheStatistics(zones).formatterConstructions).toBe(afterFirst);
  });

  test("ICAL-I31: two caches are isolated, so one caller cannot poison another's memo", () => {
    const first = createZoneCache();
    const second = createZoneCache();
    resolveWallTime({ kind: "wallTime", value: "20260615T120000" }, berlin, first);

    expect(zoneCacheStatistics(second).formatterConstructions).toBe(0);
    expect(zoneCacheStatistics(first).formatterConstructions).toBeGreaterThan(0);
  });

  test("ICAL-I31: the cache is created by createZoneCache and never shared at module level", () => {
    expect(createZoneCache()).not.toBe(createZoneCache());
    expect(zoneCacheStatistics(createZoneCache())).toEqual({
      offsetProbes: 0,
      formatterConstructions: 0,
      projectedYears: 0,
    });
  });
});
