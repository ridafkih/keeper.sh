import { describe, expect, test } from "vitest";
import { createZoneCache, findZoneTransitions } from "../../../src/index";
import { instant } from "../../support/feed";
import { testLimits } from "../../support/options";

const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
const sweptYears = { ...testLimits(), zoneProjectionYears: 68 };

describe("the bracket the two-probe wall-time resolution rests on", () => {
  test("ICAL-I21: no IANA zone transitions twice within two days", () => {
    const zones = createZoneCache();
    const window = {
      start: instant("1970-01-01T00:00:00.000Z"),
      end: instant("2038-01-01T00:00:00.000Z"),
    };
    const offenders: string[] = [];

    for (const value of Intl.supportedValuesOf("timeZone")) {
      const transitions = findZoneTransitions({ kind: "zoneId", value }, window, zones, sweptYears);
      for (let index = 1; index < transitions.length; index++) {
        const previous = transitions[index - 1];
        const current = transitions[index];
        if (!previous || !current) {
          continue;
        }
        if (Date.parse(current.value) - Date.parse(previous.value) < twoDaysMs) {
          offenders.push(`${value}@${previous.value}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
