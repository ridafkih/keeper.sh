import { describe, expect, it } from "bun:test";
import {
  isSameDay,
  getDaysFromDate,
  formatHour,
  parseDateRangeParams,
  normalizeDateRange,
} from "./index";

describe("isSameDay", () => {
  it("returns true for two dates on the same day", () => {
    const first = new Date("2026-03-08T09:00:00.000Z");
    const second = new Date("2026-03-08T23:59:59.000Z");
    expect(isSameDay(first, second)).toBe(true);
  });

  it("returns false for dates on different days", () => {
    const first = new Date("2026-03-08T09:00:00.000Z");
    const second = new Date("2026-03-09T09:00:00.000Z");
    expect(isSameDay(first, second)).toBe(false);
  });

  it("returns false for same day in different months", () => {
    const first = new Date("2026-03-08T09:00:00.000Z");
    const second = new Date("2026-04-08T09:00:00.000Z");
    expect(isSameDay(first, second)).toBe(false);
  });

  it("returns false for same day in different years", () => {
    const first = new Date("2025-03-08T09:00:00.000Z");
    const second = new Date("2026-03-08T09:00:00.000Z");
    expect(isSameDay(first, second)).toBe(false);
  });
});

describe("getDaysFromDate", () => {
  it("returns the correct number of days starting from the given date", () => {
    const start = new Date("2026-03-08T00:00:00.000Z");
    const days = getDaysFromDate(start, 3);

    expect(days).toHaveLength(3);
    const [day1, day2, day3] = days;
    expect(day1?.getDate()).toBe(8);
    expect(day2?.getDate()).toBe(9);
    expect(day3?.getDate()).toBe(10);
  });

  it("returns empty array for count of 0", () => {
    const days = getDaysFromDate(new Date(), 0);
    expect(days).toHaveLength(0);
  });

  it("does not mutate the input date", () => {
    const start = new Date("2026-03-08T00:00:00.000Z");
    const originalTime = start.getTime();
    getDaysFromDate(start, 5);
    expect(start.getTime()).toBe(originalTime);
  });
});

describe("formatHour", () => {
  it("formats midnight as 12 AM", () => {
    expect(formatHour(0)).toBe("12 AM");
  });

  it("formats noon as 12 PM", () => {
    expect(formatHour(12)).toBe("12 PM");
  });

  it("formats morning hours with AM", () => {
    expect(formatHour(9)).toBe("9 AM");
  });

  it("formats afternoon hours with PM", () => {
    expect(formatHour(15)).toBe("3 PM");
  });
});

describe("parseDateRangeParams", () => {
  it("parses from and to params from URL", () => {
    const url = new URL("https://example.com?from=2026-03-01&to=2026-03-07");
    const { from, to } = parseDateRangeParams(url);

    expect(from.toISOString()).toContain("2026-03-01");
    expect(to.toISOString()).toContain("2026-03-07");
  });

  it("defaults to 1 week range when to is missing", () => {
    const url = new URL("https://example.com?from=2026-03-01T00:00:00.000Z");
    const { from, to } = parseDateRangeParams(url);

    const diffMs = to.getTime() - from.getTime();
    const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
    expect(diffMs).toBe(oneWeekMs);
  });
});

describe("normalizeDateRange", () => {
  it("sets start to beginning of day and end to end of day", () => {
    const from = new Date("2026-03-08T14:30:00.000Z");
    const to = new Date("2026-03-10T08:00:00.000Z");

    const { start, end } = normalizeDateRange(from, to);

    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(start.getSeconds()).toBe(0);

    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
    expect(end.getSeconds()).toBe(59);
  });

  it("does not mutate the original dates", () => {
    const from = new Date("2026-03-08T14:30:00.000Z");
    const to = new Date("2026-03-10T08:00:00.000Z");
    const fromTime = from.getTime();
    const toTime = to.getTime();

    normalizeDateRange(from, to);

    expect(from.getTime()).toBe(fromTime);
    expect(to.getTime()).toBe(toTime);
  });
});
