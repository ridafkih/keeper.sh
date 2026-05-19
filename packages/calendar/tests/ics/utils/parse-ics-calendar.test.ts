import { describe, expect, it } from "vitest";
import { parseIcsCalendar, stripIanaVTimezones } from "../../../src/ics/utils/parse-ics-calendar";

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

  it("throws on malformed timezone blocks for non-IANA TZIDs (VTIMEZONE is required to resolve them)", () => {
    expect(() =>
      parseIcsCalendar({
        icsString: [
          "BEGIN:VCALENDAR",
          "VERSION:2.0",
          "PRODID:-//Keeper Test//EN",
          "BEGIN:VTIMEZONE",
          "TZID:Eastern Standard Time",
          "BEGIN:STANDARD",
          "DTSTART:INVALID",
          "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
          "END:STANDARD",
          "END:VTIMEZONE",
          "BEGIN:VEVENT",
          "UID:event-1",
          "DTSTART;TZID=Eastern Standard Time:20260310T090000",
          "DURATION:PT30M",
          "SUMMARY:Timezone Event",
          "END:VEVENT",
          "END:VCALENDAR",
        ].join("\r\n"),
      }))
      .toThrow();
  });

  // Regression: iCloud (and other servers) embed historical VTIMEZONE blocks
  // whose recurrence rules are truncated at the year DST was last applied.
  // For zones that abolished DST after that year (e.g. America/Montevideo in
  // 2015), the embedded rules extrapolate DST forward forever, yielding the
  // wrong UTC offset (-02:00 instead of -03:00).
  //
  // We strip VTIMEZONE blocks for IANA zones so ts-ics falls back to the
  // platform's tzdata, which has accurate post-abolition rules.
  it("uses platform tzdata for IANA zones with stale VTIMEZONE (America/Montevideo)", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Apple Inc.//macOS//EN",
      "BEGIN:VEVENT",
      "UID:maciel",
      "DTSTAMP:20260518T215405Z",
      "DTSTART;TZID=America/Montevideo:20260519T080000",
      "DTEND;TZID=America/Montevideo:20260519T110000",
      "SUMMARY:Maciel",
      "END:VEVENT",
      "BEGIN:VTIMEZONE",
      "TZID:America/Montevideo",
      "X-LIC-LOCATION:America/Montevideo",
      "BEGIN:DAYLIGHT",
      "DTSTART:20061001T020000",
      "RRULE:FREQ=YEARLY;UNTIL=20141005T050000Z;BYMONTH=10;BYDAY=1SU",
      "TZNAME:-02",
      "TZOFFSETFROM:-0300",
      "TZOFFSETTO:-0200",
      "END:DAYLIGHT",
      "BEGIN:STANDARD",
      "DTSTART:20060312T020000",
      "RRULE:FREQ=YEARLY;UNTIL=20150308T040000Z;BYMONTH=3;BYDAY=2SU",
      "TZNAME:-03",
      "TZOFFSETFROM:-0200",
      "TZOFFSETTO:-0300",
      "END:STANDARD",
      "END:VTIMEZONE",
      "END:VCALENDAR",
    ].join("\r\n");

    const parsed = parseIcsCalendar({ icsString: ics });
    const event = parsed.events?.[0];
    expect(event?.uid).toBe("maciel");
    // 2026-05-19 08:00 in America/Montevideo (UTC-3, no DST since 2015) is 11:00 UTC.
    // Without the fix, the stale VTIMEZONE would yield 10:00 UTC (UTC-2, off by one hour).
    expect(event?.start?.date?.toISOString()).toBe("2026-05-19T11:00:00.000Z");
    expect(event?.end?.date?.toISOString()).toBe("2026-05-19T14:00:00.000Z");
    expect(event?.start?.local?.timezone).toBe("America/Montevideo");
  });
});

describe("stripIanaVTimezones", () => {
  const sample = (tzid: string) =>
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VTIMEZONE",
      `TZID:${tzid}`,
      "BEGIN:STANDARD",
      "DTSTART:20060312T020000",
      "TZOFFSETFROM:-0200",
      "TZOFFSETTO:-0300",
      "END:STANDARD",
      "END:VTIMEZONE",
      "END:VCALENDAR",
    ].join("\r\n");

  it("strips VTIMEZONE blocks for IANA zones", () => {
    expect(stripIanaVTimezones(sample("America/Montevideo"))).not.toContain("BEGIN:VTIMEZONE");
    expect(stripIanaVTimezones(sample("Europe/Madrid"))).not.toContain("BEGIN:VTIMEZONE");
    expect(stripIanaVTimezones(sample("Etc/GMT+3"))).not.toContain("BEGIN:VTIMEZONE");
  });

  it("keeps VTIMEZONE blocks for non-IANA TZIDs (Windows-style names, custom labels)", () => {
    expect(stripIanaVTimezones(sample("Eastern Standard Time"))).toContain("BEGIN:VTIMEZONE");
    expect(stripIanaVTimezones(sample("Pacific Standard Time"))).toContain("BEGIN:VTIMEZONE");
    expect(stripIanaVTimezones(sample("Custom Bankingly Zone"))).toContain("BEGIN:VTIMEZONE");
  });

  it("processes multiple VTIMEZONE blocks independently", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VTIMEZONE",
      "TZID:America/Montevideo",
      "END:VTIMEZONE",
      "BEGIN:VTIMEZONE",
      "TZID:Eastern Standard Time",
      "END:VTIMEZONE",
      "END:VCALENDAR",
    ].join("\r\n");
    const stripped = stripIanaVTimezones(ics);
    expect(stripped).not.toContain("TZID:America/Montevideo");
    expect(stripped).toContain("TZID:Eastern Standard Time");
  });
});
