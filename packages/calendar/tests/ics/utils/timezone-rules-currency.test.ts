import { describe, expect, it } from "vitest";
import { getTimeZoneOffsetMinutes, wallTimeToInstant } from "../../../src/ics/utils/timezone-instant";

const rulesChangedIn2026 = [
  { offsetMinutes: -360, timeZone: "America/Edmonton" },
  { offsetMinutes: -420, timeZone: "America/Vancouver" },
  { offsetMinutes: -300, timeZone: "America/Winnipeg" },
  { offsetMinutes: -360, timeZone: "America/Yellowknife" },
  { offsetMinutes: -240, timeZone: "America/Havana" },
  { offsetMinutes: 0, timeZone: "Africa/Casablanca" },
];

describe("timezone rules the runtime resolves", () => {
  it.each(rulesChangedIn2026)(
    "applies the current $timeZone offset after its 2026 rule change",
    ({ offsetMinutes, timeZone }) => {
      const instant = new Date("2027-01-15T18:00:00.000Z");
      expect(getTimeZoneOffsetMinutes(instant, timeZone)).toBe(offsetMinutes);

      const wallTime = new Date(instant.getTime() + offsetMinutes * 60_000);
      expect(wallTimeToInstant(wallTime, timeZone)).toEqual(instant);
    },
  );
});
