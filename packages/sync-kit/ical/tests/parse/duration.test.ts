import { describe, expect, test } from "vitest";
import { parseIcsDuration } from "../../src/index";

describe("RFC 5545 §3.3.6 DURATION", () => {
  test("ICAL-I23: a day-based duration is nominal, so it survives a DST boundary as wall clock", () => {
    expect(parseIcsDuration("P1D")).toEqual({ kind: "nominal", days: 1 });
    expect(parseIcsDuration("P2W")).toEqual({ kind: "nominal", days: 14 });
  });

  test("ICAL-I23: an hour-based duration is exact, measured in seconds on the instant line", () => {
    expect(parseIcsDuration("PT1H30M")).toEqual({ kind: "exact", seconds: 5400 });
    expect(parseIcsDuration("PT45S")).toEqual({ kind: "exact", seconds: 45 });
  });

  test("ICAL-I23: a mixed nominal and exact duration is not silently flattened to one of them", () => {
    expect(parseIcsDuration("P1DT2H")).toBeNull();
  });

  test("ICAL-I24: a negative duration is refused rather than repaired into a zero-length event", () => {
    expect(parseIcsDuration("-PT1H")).toBeNull();
  });

  test("ICAL-I24: a syntactically invalid duration is refused, never guessed", () => {
    expect(parseIcsDuration("PT")).toBeNull();
    expect(parseIcsDuration("1H")).toBeNull();
    expect(parseIcsDuration("")).toBeNull();
  });
});
