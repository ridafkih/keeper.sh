import { describe, expect, it } from "vitest";
import {
  parseEventDateTime,
  parseEventTime,
} from "../../../../src/providers/google/shared/date-time";

describe("offset-less date-times", () => {
  it("reads an offset-less date-time in its declared timeZone", () => {
    expect(
      parseEventTime({ dateTime: "2026-11-03T09:00:00", timeZone: "America/Edmonton" })?.getTime(),
    ).toBe(Date.UTC(2026, 10, 3, 15, 0, 0));
  });

  it("reads an offset-less date-time across a DST change in its declared timeZone", () => {
    expect(
      parseEventTime({ dateTime: "2026-07-01T09:00:00", timeZone: "Pacific/Auckland" })?.getTime(),
    ).toBe(Date.UTC(2026, 5, 30, 21, 0, 0));
  });

  it("treats an offset-less date-time without a timeZone as unrepresentable", () => {
    expect(parseEventTime({ dateTime: "2026-11-03T09:00:00" })).toBeNull();
  });

  it("treats an offset-less date-time in an unknown timeZone as unrepresentable", () => {
    expect(parseEventTime({ dateTime: "2026-11-03T09:00:00", timeZone: "Nowhere/Land" })).toBeNull();
  });

  it("parseEventDateTime throws a RangeError naming the value", () => {
    expect(() => parseEventDateTime({ dateTime: "2026-11-03T09:00:00" }))
      .toThrow(/2026-11-03T09:00:00/);
    expect(() => parseEventDateTime({ dateTime: "2026-11-03T09:00:00" })).toThrow(RangeError);
  });
});

describe("malformed or impossible values are unrepresentable instead of rolling to another day", () => {
  it.each([
    ["an impossible date", { date: "2026-02-30" }],
    ["an impossible date-time", { dateTime: "2026-02-30T09:00:00Z" }],
    ["an impossible wall clock", { dateTime: "2026-11-03T24:30:00", timeZone: "UTC" }],
    ["a slash-separated date", { date: "2026/11/03" }],
    ["an unpadded date", { date: "2026-11-3" }],
    ["a date-time in the date field", { date: "2026-11-03T00:00" }],
    ["a non-date date-time", { dateTime: "not-a-date" }],
    ["a non-date date", { date: "not-a-date" }],
  ])("parseEventTime returns null for %s", (_label, time) => {
    expect(parseEventTime(time)).toBeNull();
  });

  it("parseEventDateTime throws RangeError for an impossible date", () => {
    expect(() => parseEventDateTime({ date: "2026-02-30" })).toThrow(RangeError);
  });
});

describe("valid RFC 3339 values map to exact instants", () => {
  it.each([
    ["a Z suffix", "2026-11-03T09:00:00Z", Date.UTC(2026, 10, 3, 9, 0, 0)],
    ["a lowercase t and z", "2026-11-03t09:00:00z", Date.UTC(2026, 10, 3, 9, 0, 0)],
    ["a negative offset", "2026-11-03T09:00:00-06:00", Date.UTC(2026, 10, 3, 15, 0, 0)],
    ["a quarter-hour offset", "2026-11-03T09:00:00+05:45", Date.UTC(2026, 10, 3, 3, 15, 0)],
    ["fractional seconds", "2026-11-03T09:00:00.250Z", Date.UTC(2026, 10, 3, 9, 0, 0, 250)],
  ])("parses %s", (_label, dateTime, expected) => {
    expect(parseEventDateTime({ dateTime }).getTime()).toBe(expected);
  });

  it("parses an offset date-time with a timeZone by its offset", () => {
    expect(
      parseEventTime({ dateTime: "2026-11-03T09:00:00-07:00", timeZone: "America/Edmonton" })?.getTime(),
    ).toBe(Date.UTC(2026, 10, 3, 16, 0, 0));
  });

  it("maps an all-day date to UTC midnight", () => {
    expect(parseEventTime({ date: "2026-11-03" })?.getTime()).toBe(Date.UTC(2026, 10, 3));
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
