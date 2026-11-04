import { describe, expect, it } from "vitest";
import { offsetPartsToMinutes } from "../../../src/ics/utils/utc-offset";

describe("offsetPartsToMinutes", () => {
  it("reads signed hours and minutes", () => {
    expect(offsetPartsToMinutes("+", "05", "30")).toBe(330);
    expect(offsetPartsToMinutes("-", "03", "30")).toBe(-210);
  });

  it("keeps seconds as a fraction of a minute, unrounded", () => {
    expect(offsetPartsToMinutes("+", "00", "19", "32")).toBeCloseTo(19 + 32 / 60, 10);
    expect(offsetPartsToMinutes("-", "00", "00", "30")).toBe(-0.5);
  });
});
