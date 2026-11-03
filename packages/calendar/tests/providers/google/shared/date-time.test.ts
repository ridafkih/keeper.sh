import { describe, expect, it } from "vitest";
import {
  parseEventDateTime,
  parseEventTime,
} from "../../../../src/providers/google/shared/date-time";
import type { PartialGoogleDateTime } from "../../../../src/providers/google/types";

const parsers = [
  ["parseEventDateTime", (time: PartialGoogleDateTime) => parseEventDateTime(time)],
  ["parseEventTime", (time: PartialGoogleDateTime) => parseEventTime(time)],
] as const;

describe.each(parsers)("%s", (_name, parse) => {
  describe("rejects offset-less date-times instead of reading them in server-local time", () => {
    it("throws RangeError without a timeZone", () => {
      expect(() => parse({ dateTime: "2026-11-03T09:00:00" })).toThrow(RangeError);
    });

    it("throws RangeError with a timeZone", () => {
      expect(() =>
        parse({ dateTime: "2026-11-03T09:00:00", timeZone: "America/Edmonton" }),
      ).toThrow(RangeError);
    });

    it("names the offending value in the error", () => {
      expect(() => parse({ dateTime: "2026-11-03T09:00:00" })).toThrow(/2026-11-03T09:00:00/);
    });
  });

  describe("rejects malformed or impossible values instead of rolling them to another day", () => {
    it.each([
      ["an impossible date", { date: "2026-02-30" }],
      ["an impossible date-time", { dateTime: "2026-02-30T09:00:00Z" }],
      ["a slash-separated date", { date: "2026/11/03" }],
      ["an unpadded date", { date: "2026-11-3" }],
      ["a date-time in the date field", { date: "2026-11-03T00:00" }],
      ["a non-date date-time", { dateTime: "not-a-date" }],
      ["a non-date date", { date: "not-a-date" }],
    ])("throws RangeError for %s", (_label, time) => {
      expect(() => parse(time)).toThrow(RangeError);
    });
  });

  describe("maps valid RFC 3339 values to exact instants", () => {
    it.each([
      ["a Z suffix", "2026-11-03T09:00:00Z", Date.UTC(2026, 10, 3, 9, 0, 0)],
      ["a lowercase t and z", "2026-11-03t09:00:00z", Date.UTC(2026, 10, 3, 9, 0, 0)],
      ["a negative offset", "2026-11-03T09:00:00-06:00", Date.UTC(2026, 10, 3, 15, 0, 0)],
      ["a quarter-hour offset", "2026-11-03T09:00:00+05:45", Date.UTC(2026, 10, 3, 3, 15, 0)],
      ["fractional seconds", "2026-11-03T09:00:00.250Z", Date.UTC(2026, 10, 3, 9, 0, 0, 250)],
    ])("parses %s", (_label, dateTime, expected) => {
      expect(parse({ dateTime })?.getTime()).toBe(expected);
    });

    it("parses an offset date-time with a timeZone by its offset", () => {
      expect(
        parse({ dateTime: "2026-11-03T09:00:00-07:00", timeZone: "America/Edmonton" })?.getTime(),
      ).toBe(Date.UTC(2026, 10, 3, 16, 0, 0));
    });

    it("maps an all-day date to UTC midnight", () => {
      expect(parse({ date: "2026-11-03" })?.getTime()).toBe(Date.UTC(2026, 10, 3));
    });
  });
});

describe("missing times", () => {
  it("parseEventTime returns null for an absent time", () => {
    expect(parseEventTime()).toBeNull();
  });

  it("parseEventTime returns null for a time zone without a date or date-time", () => {
    expect(parseEventTime({ timeZone: "UTC" })).toBeNull();
  });

  it("parseEventDateTime throws for a time with no date or date-time", () => {
    expect(() => parseEventDateTime({})).toThrow();
  });
});
