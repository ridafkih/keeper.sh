import { describe, expect, test } from "vitest";
import { createZoneCache, instantToWallTime, resolveWallTime } from "../../../src/index";
import { adversarialZoneList } from "../../support/sweep";

const hourMs = 60 * 60 * 1000;

describe("a dense sweep of instants through the wall clock and back", () => {
  test("ICAL-I20: every instant resolves back to itself or to an earlier instant, never a later one", () => {
    const zones = createZoneCache();
    const offenders: string[] = [];
    const startMs = Date.parse("2026-01-01T00:00:00.000Z");

    for (const value of adversarialZoneList) {
      const zone = { kind: "zoneId", value } as const;
      for (let step = 0; step < 24 * 400; step++) {
        const source = { kind: "instant", value: new Date(startMs + step * hourMs).toISOString() } as const;
        const resolved = resolveWallTime(instantToWallTime(source, zone, zones), zone, zones);
        if (Date.parse(resolved.instant.value) > Date.parse(source.value)) {
          offenders.push(`${value}@${source.value}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
