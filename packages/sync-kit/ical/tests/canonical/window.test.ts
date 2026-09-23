import type { EventTime } from "@keeper.sh/sync-protocol";
import { describe, expect, test } from "vitest";
import { withinTimeWindow } from "../../src/index";
import { instant, testWindow } from "../support/feed";

const timed = (start: string, end: string): EventTime => ({
  kind: "timed",
  start: instant(start),
  end: instant(end),
  zone: null,
});

describe("the one window predicate this package owns", () => {
  test("ICAL-I25: a degenerate zero-length event inside the window is a member", () => {
    expect(withinTimeWindow(testWindow, timed("2026-06-01T09:00:00.000Z", "2026-06-01T09:00:00.000Z"))).toBe(
      true,
    );
  });

  test("ICAL-I25: an event straddling the window start is a member", () => {
    expect(withinTimeWindow(testWindow, timed("2025-12-31T23:00:00.000Z", "2026-01-01T01:00:00.000Z"))).toBe(
      true,
    );
  });

  test("ICAL-I25: an event entirely before the window is not a member", () => {
    expect(withinTimeWindow(testWindow, timed("1998-07-04T09:00:00.000Z", "1998-07-04T10:00:00.000Z"))).toBe(
      false,
    );
  });

  test("ICAL-I25: an all-day event is judged on its exclusive end date", () => {
    const allDay: EventTime = {
      kind: "allDay",
      startDate: { kind: "calendarDate", value: "2026-06-01" },
      endDateExclusive: { kind: "calendarDate", value: "2026-06-02" },
    };

    expect(withinTimeWindow(testWindow, allDay)).toBe(true);
  });

  test("ICAL-I25: an event touching only the exclusive window end is not a member", () => {
    expect(withinTimeWindow(testWindow, timed("2027-01-01T00:00:00.000Z", "2027-01-01T01:00:00.000Z"))).toBe(
      false,
    );
  });
});
