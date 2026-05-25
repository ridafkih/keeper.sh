import { describe, expect, it } from "vitest";
import { parseIcsCalendarLenient } from "../../../src/ics/utils/lenient-parser";
import { coerceCompliantDate } from "../../../src/ics/patches/coerce-compliant-date";
import { parseIcsEvents } from "../../../src/ics/utils/parse-ics-events";

/**
 * Synthetic ICS that mirrors the GameChanger non-compliance shape: a mix of
 * timed events (compliant) and all-day events written with bare 8-digit dates
 * (RFC 5545 §3.3.4 / §3.8.2.4 violation — DATE values require VALUE=DATE).
 */
const GAMECHANGER_STYLE_ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Synthetic Test Provider//EN",
  "BEGIN:VEVENT",
  "UID:timed-event",
  "DTSTART:20260411T183000Z",
  "DTEND:20260411T200000Z",
  "SUMMARY:Practice",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:all-day-event",
  "DTSTART:20260515",
  "DTEND:20260518",
  "SUMMARY:Tournament",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("parseIcsCalendarLenient", () => {
  it("recovers all-day events that omit VALUE=DATE", () => {
    const calendar = parseIcsCalendarLenient({
      icsString: GAMECHANGER_STYLE_ICS,
      patches: [coerceCompliantDate],
    });
    const events = parseIcsEvents(calendar);

    expect(events).toHaveLength(2);

    const allDay = events.find((event) => event.uid === "all-day-event");
    if (!allDay) {
      throw new TypeError("Expected all-day event");
    }
    expect(allDay.isAllDay).toBe(true);
    expect(Number.isNaN(allDay.startTime.getTime())).toBe(false);
    expect(Number.isNaN(allDay.endTime.getTime())).toBe(false);
    expect(allDay.startTime.toISOString().startsWith("2026-05-15")).toBe(true);
    expect(allDay.endTime.toISOString().startsWith("2026-05-18")).toBe(true);

    const timed = events.find((event) => event.uid === "timed-event");
    if (!timed) {
      throw new TypeError("Expected timed event");
    }
    expect(timed.isAllDay).toBe(false);
    expect(timed.startTime.toISOString()).toBe("2026-04-11T18:30:00.000Z");
    expect(timed.endTime.toISOString()).toBe("2026-04-11T20:00:00.000Z");
  });

  it("leaves spec-compliant feeds untouched", () => {
    const compliant = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Synthetic Test Provider//EN",
      "BEGIN:VEVENT",
      "UID:compliant",
      "DTSTART;VALUE=DATE:20260515",
      "DTEND;VALUE=DATE:20260518",
      "SUMMARY:Already Correct",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const calendar = parseIcsCalendarLenient({
      icsString: compliant,
      patches: [coerceCompliantDate],
    });
    const events = parseIcsEvents(calendar);

    expect(events).toHaveLength(1);
    expect(events[0]?.isAllDay).toBe(true);
  });
});
