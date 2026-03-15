import { describe, expect, it } from "bun:test";
import {
  hasActiveFutureOccurrence,
  parseExceptionDatesFromJson,
  parseRecurrenceRuleFromJson,
} from "./recurrence";

describe("parseRecurrenceRuleFromJson", () => {
  it("returns null when json is invalid or frequency is missing", () => {
    expect(parseRecurrenceRuleFromJson(null)).toBeNull();
    expect(parseRecurrenceRuleFromJson("{")).toBeNull();
    expect(parseRecurrenceRuleFromJson(JSON.stringify({ interval: 1 }))).toBeNull();
  });

  it("normalizes valid recurrence rule fields", () => {
    const recurrenceRule = parseRecurrenceRuleFromJson(
      JSON.stringify({
        byDay: [{ day: "MO", occurrence: 1 }],
        byMonth: [1, 6],
        count: 8,
        frequency: "WEEKLY",
        interval: 2,
        until: { date: "2026-12-31T00:00:00.000Z" },
      }),
    );

    expect(recurrenceRule).toBeDefined();
    expect(recurrenceRule?.frequency).toBe("WEEKLY");
    expect(recurrenceRule?.interval).toBe(2);
    expect(recurrenceRule?.count).toBe(8);
    expect(recurrenceRule?.byDay).toEqual([{ day: "MO", occurrence: 1 }]);
    expect(recurrenceRule?.byMonth).toEqual([1, 6]);
    expect(recurrenceRule?.until?.date).toBeInstanceOf(Date);
  });
});

describe("parseExceptionDatesFromJson", () => {
  it("returns valid dates and drops invalid entries", () => {
    const exceptionDates = parseExceptionDatesFromJson(
      JSON.stringify([
        { date: "2026-03-10T10:00:00.000Z" },
        { date: "not-a-date" },
        { value: "missing-date" },
      ]),
    );

    expect(exceptionDates).toBeDefined();
    expect(exceptionDates).toHaveLength(1);
    expect(exceptionDates?.[0]).toBeInstanceOf(Date);
    expect(exceptionDates?.[0]?.toISOString()).toBe("2026-03-10T10:00:00.000Z");
  });
});

describe("hasActiveFutureOccurrence", () => {
  it("returns true when a recurring series has future occurrences", () => {
    const recurrenceRule = parseRecurrenceRuleFromJson(
      JSON.stringify({
        count: 10,
        frequency: "DAILY",
        interval: 1,
      }),
    );

    const hasFutureOccurrence = hasActiveFutureOccurrence(
      new Date("2026-03-01T10:00:00.000Z"),
      recurrenceRule,
      [],
      new Date("2026-03-05T00:00:00.000Z"),
    );

    expect(hasFutureOccurrence).toBe(true);
  });

  it("returns false when recurrence has no future occurrences", () => {
    const recurrenceRule = parseRecurrenceRuleFromJson(
      JSON.stringify({
        count: 1,
        frequency: "DAILY",
      }),
    );

    const hasFutureOccurrence = hasActiveFutureOccurrence(
      new Date("2026-03-01T10:00:00.000Z"),
      recurrenceRule,
      [],
      new Date("2026-03-02T00:00:00.000Z"),
    );

    expect(hasFutureOccurrence).toBe(false);
  });
});
