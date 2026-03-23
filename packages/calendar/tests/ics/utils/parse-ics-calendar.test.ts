import { describe, expect, it } from "bun:test";
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
});
