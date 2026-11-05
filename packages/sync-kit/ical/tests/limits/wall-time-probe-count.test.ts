import { describe, expect, test } from "vitest";
import { createZoneCache, resolveWallTime, zoneCacheStatistics } from "../../src/index";

const adversarialZones = [
  "Europe/Berlin",
  "America/New_York",
  "Australia/Lord_Howe",
  "Pacific/Chatham",
  "Asia/Kathmandu",
  "America/Santiago",
  "Africa/Casablanca",
  "Pacific/Apia",
  "Asia/Tehran",
  "Antarctica/Troll",
] as const;

const wallTimes = ["20260329T023000", "20261025T023000", "20260615T120000", "20260101T000000"] as const;

describe("the two-probe wall-time resolution", () => {
  for (const zone of adversarialZones) {
    test(`ICAL-L7: ${zone} resolves with at most two probes plus two verifications`, () => {
      for (const value of wallTimes) {
        const zones = createZoneCache();
        resolveWallTime({ kind: "wallTime", value }, { kind: "zoneId", value: zone }, zones);

        expect(zoneCacheStatistics(zones).offsetProbes).toBeLessThanOrEqual(4);
        expect(zoneCacheStatistics(zones).offsetProbes).toBeGreaterThanOrEqual(2);
      }
    });
  }

  test("ICAL-L7: resolving a thousand wall times does not grow the per-resolution probe count", () => {
    const zones = createZoneCache();
    for (let index = 0; index < 1000; index++) {
      const day = String((index % 28) + 1).padStart(2, "0");
      resolveWallTime(
        { kind: "wallTime", value: `202606${day}T120000` },
        { kind: "zoneId", value: "Europe/Berlin" },
        zones,
      );
    }

    expect(zoneCacheStatistics(zones).offsetProbes).toBeLessThanOrEqual(4000);
  });

  test("ICAL-L7: a full feed's worth of resolutions stays at a constant probe cost each", () => {
    const resolutions = 10_000;
    const zones = createZoneCache();
    for (let index = 0; index < resolutions; index++) {
      resolveWallTime(
        { kind: "wallTime", value: "20260615T120000" },
        { kind: "zoneId", value: "Europe/Berlin" },
        zones,
      );
    }

    expect(zoneCacheStatistics(zones).offsetProbes).toBeLessThanOrEqual(resolutions * 4);
  });
});
