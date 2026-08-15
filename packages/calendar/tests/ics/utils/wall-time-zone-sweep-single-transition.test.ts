import { describe, expect, it } from "vitest";
import {
  collectTransitions,
  MS_PER_DAY,
  SWEEP_TIMEOUT_MS,
  sweepTimeZones,
} from "./tz-sweep-support";

describe("resolving a wall time near every transition IANA declares", () => {
  it("finds no zone that changes offset twice within two days", () => {
    const closePairs: string[] = [];

    for (const timeZone of sweepTimeZones()) {
      const transitions = collectTransitions(timeZone, Date.UTC(1970, 0, 1), Date.UTC(2038, 0, 1));
      for (let index = 1; index < transitions.length; index += 1) {
        const previous = transitions[index - 1];
        const current = transitions[index];
        if (previous && current && current.instant - previous.instant < 2 * MS_PER_DAY) {
          closePairs.push(`${timeZone} ${new Date(current.instant).toISOString()}`);
        }
      }
    }

    expect(closePairs).toEqual([]);
  }, SWEEP_TIMEOUT_MS);
});
