import { describe, expect, it } from "vitest";
import {
  parseStoredIcsExceptionDates,
  parseStoredIcsRecurrenceRule,
  parseStoredRecurrenceForMaterialization,
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
      .toThrow(
        "Invalid exceptionDates shape for event event-bad-shape: must be an array (was object)",
      );
  });

  it("converts every stored recurrence field into the materializer domain", () => {
    const recurrenceId = new Date("2026-03-12T10:00:00.000Z");

    expect(parseStoredRecurrenceForMaterialization({
      eventId: "event-materialization-contract",
      exceptionDates: JSON.stringify([
        { date: "2026-03-19T10:00:00.000Z", type: "DATE-TIME" },
      ]),
      recurrenceId,
      recurrenceRule: JSON.stringify({
        frequency: "WEEKLY",
        until: { date: "2026-12-31T00:00:00.000Z" },
      }),
    })).toEqual({
      exceptionDates: [new Date("2026-03-19T10:00:00.000Z")],
      recurrenceId,
      recurrenceRule: {
        frequency: "WEEKLY",
        until: { date: new Date("2026-12-31T00:00:00.000Z") },
      },
    });
  });

  it("uses the same fail-closed validation for every materialization consumer", () => {
    expect(() => parseStoredRecurrenceForMaterialization({
      eventId: "event-invalid-contract",
      exceptionDates: "not-json",
      recurrenceId: null,
      recurrenceRule: null,
    })).toThrow(
      "Failed to JSON.parse exceptionDates for event event-invalid-contract",
    );
  });
});
