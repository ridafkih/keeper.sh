import { describe, expect, test } from "vitest";
import { createZoneCache, findZoneTransitions, zoneCacheStatistics } from "../../src/index";
import { instant } from "../support/feed";
import { testLimits } from "../support/options";

const berlin = { kind: "zoneId", value: "Europe/Berlin" } as const;

const projectionWindow = (years: number) => ({
  start: instant("2000-01-01T00:00:00.000Z"),
  end: instant(`${2000 + years}-01-01T00:00:00.000Z`),
});

describe("finding the transitions inside a projection window", () => {
  test("ICAL-L6: the search makes O(log window) probes per transition, not O(window)", () => {
    const years = testLimits().zoneProjectionYears;
    const zones = createZoneCache();
    const transitions = findZoneTransitions(berlin, projectionWindow(years), zones, testLimits());
    const probes = zoneCacheStatistics(zones).offsetProbes;

    expect(transitions.length).toBe(years * 2);
    expect(probes).toBeLessThan(transitions.length * 32);
  });

  test("ICAL-L6: doubling the window does not square the probe count", () => {
    const narrowZones = createZoneCache();
    findZoneTransitions(berlin, projectionWindow(10), narrowZones, testLimits());
    const narrowProbes = zoneCacheStatistics(narrowZones).offsetProbes;

    const wideZones = createZoneCache();
    findZoneTransitions(berlin, projectionWindow(20), wideZones, testLimits());
    const wideProbes = zoneCacheStatistics(wideZones).offsetProbes;

    expect(wideProbes).toBeLessThan(narrowProbes * 3);
  });

  test("ICAL-L6: a fixed-offset zone finds no transitions and still terminates", () => {
    const zones = createZoneCache();

    expect(findZoneTransitions({ kind: "zoneId", value: "UTC" }, projectionWindow(400), zones, testLimits())).toEqual([]);
  });

  test("ICAL-L6: an absurd window costs no more probes than the ceiling it clamps to", () => {
    const zones = createZoneCache();
    const transitions = findZoneTransitions(berlin, projectionWindow(400), zones, testLimits());

    expect(zoneCacheStatistics(zones).offsetProbes).toBeLessThan(transitions.length * 32);
  });

  test("ICAL-L6: a caller-supplied window wider than the projection ceiling is clamped, not scanned", () => {
    const clamped = findZoneTransitions(berlin, projectionWindow(4000), createZoneCache(), testLimits());

    expect(clamped.length).toBe(testLimits().zoneProjectionYears * 2);
  });
});
