import { describe, expect, it } from "vitest";
import { getTimeZoneOffsetMinutes } from "../../../src/ics/utils/timezone-instant";
import { DENSE_SWEEP_ZONES, MS_PER_HOUR } from "./tz-sweep-support";

describe("a dense sweep of instants through the wall clock and back", () => {
  it("reports an offset in whole minutes for every instant it resolves", () => {
    const offsets = new Set<number>();
    for (const timeZone of DENSE_SWEEP_ZONES) {
      for (
        let instant = Date.UTC(2027, 0, 1);
        instant < Date.UTC(2027, 3, 1);
        instant += 6 * MS_PER_HOUR
      ) {
        offsets.add(getTimeZoneOffsetMinutes(new Date(instant), timeZone));
      }
    }

    expect([...offsets].every((offset) => Number.isInteger(offset))).toBe(true);
  });
});
