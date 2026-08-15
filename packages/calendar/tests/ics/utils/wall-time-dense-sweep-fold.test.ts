import { describe, expect, it } from "vitest";
import { instantToWallTime, wallTimeToInstant } from "../../../src/ics/utils/timezone-instant";
import { DENSE_SWEEP_ZONES, MS_PER_MINUTE, SWEEP_TIMEOUT_MS } from "./tz-sweep-support";

describe("a dense sweep of instants through the wall clock and back", () => {
  it("returns the instant it was given outside a fold and never a later one", () => {
    const drifted: string[] = [];

    for (const timeZone of DENSE_SWEEP_ZONES) {
      for (
        let instant = Date.UTC(2027, 0, 1);
        instant < Date.UTC(2028, 0, 1);
        instant += 17 * MS_PER_MINUTE
      ) {
        const wallTime = instantToWallTime(new Date(instant), timeZone);
        const resolved = wallTimeToInstant(wallTime, timeZone).getTime();
        if (resolved > instant) {
          drifted.push(`${timeZone} ${new Date(instant).toISOString()} moved forward`);
          continue;
        }
        if (instantToWallTime(new Date(resolved), timeZone).getTime() !== wallTime.getTime()) {
          drifted.push(`${timeZone} ${new Date(instant).toISOString()} lost its wall time`);
        }
      }
    }

    expect(drifted).toEqual([]);
  }, SWEEP_TIMEOUT_MS);
});
