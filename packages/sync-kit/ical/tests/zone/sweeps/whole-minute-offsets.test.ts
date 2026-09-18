import { describe, expect, test } from "vitest";
import { createZoneCache, zoneOffsetMinutes } from "../../../src/index";
import { seededSample } from "../../support/sweep";

const hourMs = 60 * 60 * 1000;

describe("a seeded sample of instants across every zone the platform knows", () => {
  test("ICAL-I22: every reported offset is a whole number of minutes", () => {
    const zones = createZoneCache();
    const sampled = seededSample([...Intl.supportedValuesOf("timeZone")], 400, 20_260_815);
    const startMs = Date.parse("1970-01-01T00:00:00.000Z");
    const offenders: string[] = [];

    for (const value of sampled) {
      const zone = { kind: "zoneId", value } as const;
      for (let step = 0; step < 200; step++) {
        const at = { kind: "instant", value: new Date(startMs + step * 4000 * hourMs).toISOString() } as const;
        const offset = zoneOffsetMinutes(at, zone, zones);
        if (!Number.isInteger(offset)) {
          offenders.push(`${value}@${at.value}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
