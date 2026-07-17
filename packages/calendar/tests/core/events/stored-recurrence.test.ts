import { describe, expect, it } from "vitest";
import {
  parseStoredIcsExceptionDates,
  parseStoredIcsRecurrenceRule,
} from "../../../src/core/events/stored-recurrence";

describe("stored recurrence parsing", () => {
  it("validates recurrence rules and restores nested dates", () => {
    const rule = parseStoredIcsRecurrenceRule(
      JSON.stringify({
        byDay: [{ day: "MO" }],
        frequency: "WEEKLY",
        until: { date: "2026-12-31T00:00:00.000Z" },
      }),
      "event-1",
    );

    expect(rule?.frequency).toBe("WEEKLY");
    expect(rule?.until?.date).toBeInstanceOf(Date);
    expect(rule?.until?.date.toISOString()).toBe("2026-12-31T00:00:00.000Z");
  });

  it("validates exception dates and restores dates", () => {
    const exceptions = parseStoredIcsExceptionDates(
      JSON.stringify([
        { date: "2026-03-19T10:00:00.000Z", type: "DATE-TIME" },
      ]),
      "event-2",
    );

    expect(exceptions?.[0]?.date).toBeInstanceOf(Date);
    expect(exceptions?.[0]?.date.toISOString()).toBe("2026-03-19T10:00:00.000Z");
  });

  it("rejects malformed JSON with field and event context", () => {
    expect(() => parseStoredIcsRecurrenceRule("{", "event-bad-json"))
      .toThrow("Failed to JSON.parse recurrenceRule for event event-bad-json");
  });

  it("rejects valid JSON with an invalid recurrence shape", () => {
    expect(() => parseStoredIcsExceptionDates('{"dates":[]}', "event-bad-shape"))
      .toThrow("Invalid exceptionDates shape for event event-bad-shape");
  });
});
