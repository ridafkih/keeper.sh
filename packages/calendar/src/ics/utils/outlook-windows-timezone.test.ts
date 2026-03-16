import { describe, expect, it } from "bun:test";
import { parseIcsCalendar } from "./parse-ics-calendar";
import { parseIcsEvents } from "./parse-ics-events";

const OUTLOOK_ICS_WITH_WINDOWS_TIMEZONES = [
  "BEGIN:VCALENDAR",
  "METHOD:PUBLISH",
  "PRODID:Microsoft Exchange Server 2010",
  "VERSION:2.0",
  "BEGIN:VTIMEZONE",
  "TZID:Eastern Standard Time",
  "BEGIN:STANDARD",
  "DTSTART:16010101T020000",
  "TZOFFSETFROM:-0400",
  "TZOFFSETTO:-0500",
  "RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=1SU;BYMONTH=11",
  "END:STANDARD",
  "BEGIN:DAYLIGHT",
  "DTSTART:16010101T020000",
  "TZOFFSETFROM:-0500",
  "TZOFFSETTO:-0400",
  "RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=2SU;BYMONTH=3",
  "END:DAYLIGHT",
  "END:VTIMEZONE",
  "BEGIN:VEVENT",
  "UID:outlook-recurring-event-1",
  "SUMMARY:Weekly Standup",
  "RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;WKST=MO",
  "DTSTART;TZID=Eastern Standard Time:20260209T140000",
  "DTEND;TZID=Eastern Standard Time:20260209T143000",
  "DTSTAMP:20260314T183308Z",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("outlook windows timezone ICS parsing", () => {
  it("normalizes Windows timezone IDs to IANA when parsing events", () => {
    const calendar = parseIcsCalendar({ icsString: OUTLOOK_ICS_WITH_WINDOWS_TIMEZONES });
    const events = parseIcsEvents(calendar);

    expect(events).toHaveLength(1);

    const [event] = events;
    if (!event) {
      throw new TypeError("Expected parsed event");
    }

    expect(event.startTimeZone).toBe("America/New_York");
    expect(event.uid).toBe("outlook-recurring-event-1");
    expect(event.recurrenceRule).toBeDefined();
  });

  it("does not return Windows timezone ID as startTimeZone", () => {
    const calendar = parseIcsCalendar({ icsString: OUTLOOK_ICS_WITH_WINDOWS_TIMEZONES });
    const events = parseIcsEvents(calendar);

    for (const event of events) {
      if (event.startTimeZone) {
        expect(event.startTimeZone).not.toBe("Eastern Standard Time");
      }
    }
  });
});
