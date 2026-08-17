import { conformanceHash } from "@keeper.sh/sync-conformance";
import type { EditableContent, RecurrenceAnchor } from "@keeper.sh/sync-protocol";
import { describe, expect, test } from "vitest";
import { normalizeForMicrosoft } from "../../src/write/normalize";

const weekly = {
  dialect: "rfc5545",
  value: "FREQ=WEEKLY;BYDAY=MO",
  exceptions: [],
} as const;

const recurringWith = (anchor: RecurrenceAnchor): EditableContent => ({
  title: "a series the caller cannot represent",
  description: null,
  location: null,
  availability: "busy",
  visibility: "default",
  recurrence: weekly,
  anchor,
});

describe("a serialization the adapter cannot perform is a failure, never a throw", () => {
  test("MS-O48: a recurring anchor whose start does not parse is unrepresentable", () => {
    const answered = normalizeForMicrosoft(
      recurringWith({
        kind: "timed",
        start: { kind: "instant", value: "not-an-instant" },
        zone: { kind: "zoneId", value: "UTC" },
        duration: { kind: "exact", seconds: 3600 },
      }),
      conformanceHash,
    );

    expect(answered).toEqual({
      ok: false,
      failure: { kind: "unrepresentable", constraint: "invertedRange" },
    });
  });

  test("MS-O49: a nominal span past the Date range is unrepresentable rather than a RangeError", () => {
    const answered = normalizeForMicrosoft(
      recurringWith({
        kind: "timed",
        start: { kind: "instant", value: "2026-03-21T09:00:00.000Z" },
        zone: { kind: "zoneId", value: "UTC" },
        duration: { kind: "nominal", days: 500_000_000 },
      }),
      conformanceHash,
    );

    expect(answered).toEqual({
      ok: false,
      failure: { kind: "unrepresentable", constraint: "minimumSpan" },
    });
  });

  test("MS-O50: an all-day anchor past the Date range is unrepresentable", () => {
    const answered = normalizeForMicrosoft(
      recurringWith({
        kind: "allDay",
        startDate: { kind: "calendarDate", value: "2026-03-21" },
        duration: { kind: "nominal", days: Number.POSITIVE_INFINITY },
      }),
      conformanceHash,
    );

    expect(answered).toEqual({
      ok: false,
      failure: { kind: "unrepresentable", constraint: "allDayGrid" },
    });
  });

  test("MS-O51: a representable recurring anchor still normalizes", () => {
    const answered = normalizeForMicrosoft(
      recurringWith({
        kind: "timed",
        start: { kind: "instant", value: "2026-03-21T09:00:00.000Z" },
        zone: { kind: "zoneId", value: "UTC" },
        duration: { kind: "exact", seconds: 3600 },
      }),
      conformanceHash,
    );

    expect(answered.ok).toBe(true);
  });
});
