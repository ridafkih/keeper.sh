import { describe, expect, it } from "vitest";
import { readDeclaredZone } from "../../../src/ics/utils/declared-timezone-offsets";
import type { OnsetBudget } from "../../../src/ics/utils/observance-onset-bound";

const US_STYLE_ZONE = [
  "BEGIN:VTIMEZONE",
  "TZID:Custom Zone",
  "BEGIN:STANDARD",
  "DTSTART:16010101T020000",
  "TZOFFSETFROM:-0600",
  "TZOFFSETTO:-0700",
  "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
  "END:STANDARD",
  "BEGIN:DAYLIGHT",
  "DTSTART:16010101T020000",
  "TZOFFSETFROM:-0700",
  "TZOFFSETTO:-0600",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
  "END:DAYLIGHT",
  "END:VTIMEZONE",
].join("\r\n");

const createBudgetThatRunsOutAfter = (expansions: number): OnsetBudget => {
  let remaining = expansions;
  return {
    expand: (_observances, _untilYear, expandObservances) => {
      if (remaining <= 0) {
        throw new RangeError("budget spent");
      }
      remaining -= 1;
      return expandObservances();
    },
  };
};

describe("a declared zone whose wider expansion fails", () => {
  it("withholds every later event past the coverage it already had, instead of reading stale offsets", () => {
    const zone = readDeclaredZone(US_STYLE_ZONE, createBudgetThatRunsOutAfter(1));
    if (!zone) {
      throw new Error("expected the zone to be read");
    }

    expect(zone.wallTimeToInstant(new Date("2026-07-15T09:00:00.000Z")).toISOString())
      .toBe("2026-07-15T15:00:00.000Z");
    expect(() => zone.wallTimeToInstant(new Date("2040-07-15T09:00:00.000Z"))).toThrow(RangeError);
    expect(() => zone.wallTimeToInstant(new Date("2045-07-15T09:00:00.000Z"))).toThrow(RangeError);
    expect(zone.wallTimeToInstant(new Date("2027-01-15T09:00:00.000Z")).toISOString())
      .toBe("2027-01-15T16:00:00.000Z");
  });
});
