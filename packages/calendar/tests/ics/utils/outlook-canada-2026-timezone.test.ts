import { describe, expect, it } from "vitest";
import { parseIcsCalendar } from "../../../src/ics/utils/parse-ics-calendar";
import { parseIcsEvents } from "../../../src/ics/utils/parse-ics-events";

const buildOutlookIcs = (timeZoneLines: string[], timeZoneId: string, start: string, end: string): string => [
  "BEGIN:VCALENDAR",
  "METHOD:PUBLISH",
  "PRODID:Microsoft Exchange Server 2010",
  "VERSION:2.0",
  "BEGIN:VTIMEZONE",
  `TZID:${timeZoneId}`,
  ...timeZoneLines,
  "END:VTIMEZONE",
  "BEGIN:VEVENT",
  "UID:outlook-canada-2026",
  "SUMMARY:Planning",
  `DTSTART;TZID=${timeZoneId}:${start}`,
  `DTEND;TZID=${timeZoneId}:${end}`,
  "DTSTAMP:20261103T120000Z",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const ALBERTA_TIMEZONE_LINES = [
  "BEGIN:STANDARD",
  "DTSTART:16010101T000000",
  "TZOFFSETFROM:-0600",
  "TZOFFSETTO:-0600",
  "END:STANDARD",
];

const US_AND_CANADA_MOUNTAIN_TIMEZONE_LINES = [
  "BEGIN:STANDARD",
  "DTSTART:16010101T020000",
  "TZOFFSETFROM:-0600",
  "TZOFFSETTO:-0700",
  "RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=1SU;BYMONTH=11",
  "END:STANDARD",
  "BEGIN:DAYLIGHT",
  "DTSTART:16010101T020000",
  "TZOFFSETFROM:-0700",
  "TZOFFSETTO:-0600",
  "RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=2SU;BYMONTH=3",
  "END:DAYLIGHT",
];

const parseSingleEvent = (icsString: string) => {
  const [event] = parseIcsEvents(parseIcsCalendar({ icsString }));
  if (!event) {
    throw new TypeError("Expected parsed event");
  }
  return event;
};

describe("Outlook exports for Canada's 2026 Windows time zones", () => {
  it("resolves Windows' Alberta zone to America/Edmonton at its permanent UTC-6 offset", () => {
    const event = parseSingleEvent(
      buildOutlookIcs(ALBERTA_TIMEZONE_LINES, "Alberta Standard Time", "20270115T100000", "20270115T110000"),
    );

    expect(event.startTimeZone).toBe("America/Edmonton");
    expect(event.startTime.toISOString()).toBe("2027-01-15T16:00:00.000Z");
  });

  it("keeps US and Canada Mountain Time on Denver's daylight saving rules", () => {
    const winter = parseSingleEvent(
      buildOutlookIcs(US_AND_CANADA_MOUNTAIN_TIMEZONE_LINES, "Mountain Standard Time", "20270115T100000", "20270115T110000"),
    );
    const summer = parseSingleEvent(
      buildOutlookIcs(US_AND_CANADA_MOUNTAIN_TIMEZONE_LINES, "Mountain Standard Time", "20270715T100000", "20270715T110000"),
    );

    expect(winter.startTimeZone).toBe("America/Denver");
    expect(winter.startTime.toISOString()).toBe("2027-01-15T17:00:00.000Z");
    expect(summer.startTime.toISOString()).toBe("2027-07-15T16:00:00.000Z");
  });
});
