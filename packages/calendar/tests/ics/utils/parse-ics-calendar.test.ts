import { describe, expect, it } from "vitest";
import { parseIcsCalendar } from "../../../src/ics/utils/parse-ics-calendar";

describe("parseIcsCalendar", () => {
  it("parses calendar data with malformed recurrence rules", () => {
    const parsedCalendar = parseIcsCalendar({
      icsString: [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Keeper Test//EN",
        "BEGIN:VEVENT",
        "UID:malformed-rrule",
        "DTSTART:20260310T090000Z",
        "DTEND:20260310T100000Z",
        "RRULE:FREQ=INVALID",
        "SUMMARY:Malformed RRULE",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
    });

    expect(parsedCalendar.events?.length).toBe(1);
    expect(parsedCalendar.events?.[0]?.uid).toBe("malformed-rrule");
  });

  it("throws on malformed timezone blocks", () => {
    expect(() =>
      parseIcsCalendar({
        icsString: [
          "BEGIN:VCALENDAR",
          "VERSION:2.0",
          "PRODID:-//Keeper Test//EN",
          "BEGIN:VTIMEZONE",
          "TZID:America/New_York",
          "BEGIN:STANDARD",
          "DTSTART:INVALID",
          "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
          "END:STANDARD",
          "END:VTIMEZONE",
          "BEGIN:VEVENT",
          "UID:event-1",
          "DTSTART;TZID=America/New_York:20260310T090000",
          "DURATION:PT30M",
          "SUMMARY:Timezone Event",
          "END:VEVENT",
          "END:VCALENDAR",
        ].join("\r\n"),
      }))
      .toThrow();
  });

  it("captures calendar and event color properties in nonStandard", () => {
    const parsedCalendar = parseIcsCalendar({
      icsString: [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Keeper Test//EN",
        "X-APPLE-CALENDAR-COLOR:#711A76",
        "COLOR:turquoise",
        "BEGIN:VEVENT",
        "UID:event-1",
        "DTSTART:20260630T040000Z",
        "DTEND:20260630T050000Z",
        "COLOR:tomato",
        "SUMMARY:Busy",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
    });

    expect(parsedCalendar.nonStandard?.appleCalendarColor).toBe("#711A76");
    expect(parsedCalendar.nonStandard?.color).toBe("turquoise");
    expect(parsedCalendar.events?.[0]?.nonStandard?.color).toBe("tomato");
  });

  it("does not rewrite properties merely containing the word color", () => {
    const parsedCalendar = parseIcsCalendar({
      icsString: [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Keeper Test//EN",
        "BEGIN:VEVENT",
        "UID:event-1",
        "DTSTART:20260630T040000Z",
        "DTEND:20260630T050000Z",
        "SUMMARY:COLOR: a talk about turquoise",
        "DESCRIPTION:COLORS everywhere",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
    });

    expect(parsedCalendar.events?.[0]?.summary).toBe("COLOR: a talk about turquoise");
    expect(parsedCalendar.events?.[0]?.description).toBe("COLORS everywhere");
    expect(parsedCalendar.events?.[0]?.nonStandard?.color).toBeUndefined();
  });

  it("parses Google calendar timezone metadata", () => {
    const parsedCalendar = parseIcsCalendar({
      icsString: [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Keeper Test//EN",
        "X-WR-TIMEZONE:America/Toronto",
        "BEGIN:VEVENT",
        "UID:event-1",
        "DTSTART:20260630T040000Z",
        "DTEND:20260701T040000Z",
        "SUMMARY:Busy",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
    });

    expect(parsedCalendar.nonStandard?.wrTimezone).toBe("America/Toronto");
  });
});
