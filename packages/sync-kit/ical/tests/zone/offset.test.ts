import { describe, expect, test } from "vitest";
import { createZoneCache, formatUtcOffset, zoneOffsetMinutes } from "../../src/index";
import { instant } from "../support/feed";

describe("offsets on the way out of this package", () => {
  test("ICAL-I22: a positive offset is formatted as +HHMM", () => {
    expect(formatUtcOffset(330)).toBe("+0530");
  });

  test("ICAL-I22: a negative offset is formatted as -HHMM", () => {
    expect(formatUtcOffset(-330)).toBe("-0530");
  });

  test("ICAL-I22: zero is formatted as a positive offset", () => {
    expect(formatUtcOffset(0)).toBe("+0000");
  });

  test("ICAL-I22: a quarter-hour offset survives, because minutes are not rounded to hours", () => {
    expect(formatUtcOffset(345)).toBe("+0545");
  });

  test("ICAL-I22: a sub-minute offset is refused rather than truncated into a wrong offset", () => {
    expect(formatUtcOffset(30)).toBe("+0030");
    expect(() => formatUtcOffset(30.5)).toThrow();
  });

  test("ICAL-I22: every offset the zone layer reports is a whole number of minutes", () => {
    const zones = createZoneCache();
    const zonesUnderTest = ["Europe/Berlin", "Asia/Kathmandu", "Australia/Lord_Howe", "Pacific/Chatham"];

    for (const value of zonesUnderTest) {
      const offset = zoneOffsetMinutes(instant("2026-06-15T10:00:00.000Z"), { kind: "zoneId", value }, zones);
      expect(Number.isInteger(offset)).toBe(true);
    }
  });
});
