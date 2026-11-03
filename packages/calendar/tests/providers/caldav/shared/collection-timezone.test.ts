import { describe, expect, it } from "vitest";
import { resolveCollectionTimeZone } from "../../../../src/providers/caldav/shared/collection-timezone";

const vcalendarWith = (vtimezone: string[]): string =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Example//Collection Zone//EN",
    ...vtimezone,
    "END:VCALENDAR",
  ].join("\r\n");

const centralEuropeanRules = (timeZoneId: string): string[] => [
  "BEGIN:VTIMEZONE",
  `TZID:${timeZoneId}`,
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "TZNAME:CEST",
  "DTSTART:19700329T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "TZNAME:CET",
  "DTSTART:19701025T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
];

const fixedOffsetRules = (timeZoneId: string, offset: string): string[] => [
  "BEGIN:VTIMEZONE",
  `TZID:${timeZoneId}`,
  "BEGIN:STANDARD",
  `TZOFFSETFROM:${offset}`,
  `TZOFFSETTO:${offset}`,
  "DTSTART:19700101T000000",
  "END:STANDARD",
  "END:VTIMEZONE",
];

const BERLIN_VCALENDAR = vcalendarWith(centralEuropeanRules("Europe/Berlin"));

describe("resolveCollectionTimeZone", () => {
  it("reads calendar-timezone-id as the collection zone", () => {
    expect(resolveCollectionTimeZone({ calendarTimezoneId: "Asia/Manila" })).toBe("Asia/Manila");
  });

  it("reads the TZID of a VTIMEZONE delivered as CDATA", () => {
    expect(resolveCollectionTimeZone({ calendarTimezone: { _cdata: BERLIN_VCALENDAR } })).toBe(
      "Europe/Berlin",
    );
  });

  it("reads the TZID of a VTIMEZONE delivered as entity-decoded text", () => {
    expect(resolveCollectionTimeZone({ calendarTimezone: BERLIN_VCALENDAR })).toBe("Europe/Berlin");
  });

  it("reads the TZID of a VTIMEZONE delivered as a text node", () => {
    expect(resolveCollectionTimeZone({ calendarTimezone: { _text: BERLIN_VCALENDAR } })).toBe(
      "Europe/Berlin",
    );
  });

  it("reads a VTIMEZONE whose lines are separated by bare line feeds", () => {
    expect(resolveCollectionTimeZone({ calendarTimezone: BERLIN_VCALENDAR.replaceAll("\r\n", "\n") })).toBe(
      "Europe/Berlin",
    );
  });

  it("resolves a Mozilla-prefixed TZID to its IANA name", () => {
    const vcalendar = vcalendarWith(centralEuropeanRules("/mozilla.org/20050126_1/Europe/Berlin"));

    expect(resolveCollectionTimeZone({ calendarTimezone: { _cdata: vcalendar } })).toBe("Europe/Berlin");
  });

  it("resolves a calendar-timezone-id given as a text node", () => {
    expect(resolveCollectionTimeZone({ calendarTimezoneId: { _text: "Asia/Manila" } })).toBe("Asia/Manila");
  });

  it("prefers calendar-timezone-id over a conflicting VTIMEZONE", () => {
    expect(
      resolveCollectionTimeZone({
        calendarTimezone: { _cdata: BERLIN_VCALENDAR },
        calendarTimezoneId: "Asia/Manila",
      }),
    ).toBe("Asia/Manila");
  });

  it("falls back to the VTIMEZONE when calendar-timezone-id came back empty", () => {
    expect(
      resolveCollectionTimeZone({
        calendarTimezone: { _cdata: BERLIN_VCALENDAR },
        calendarTimezoneId: {},
      }),
    ).toBe("Europe/Berlin");
  });

  it("maps a custom VTIMEZONE with one fixed offset to the matching fixed IANA zone", () => {
    const vcalendar = vcalendarWith(fixedOffsetRules("Example Fixed Office Time", "+0800"));
    const resolved = resolveCollectionTimeZone({ calendarTimezone: { _cdata: vcalendar } });

    expect(resolved).toBe("Etc/GMT-8");
  });

  it("never guesses a zone for a custom VTIMEZONE that observes daylight saving", () => {
    const vcalendar = vcalendarWith(centralEuropeanRules("Example Office Time"));

    expect(resolveCollectionTimeZone({ calendarTimezone: { _cdata: vcalendar } })).toBeUndefined();
  });

  it("never guesses a zone for an unknown calendar-timezone-id", () => {
    expect(resolveCollectionTimeZone({ calendarTimezoneId: "Example/Nowhere" })).toBeUndefined();
  });

  it("returns no zone when neither property is present", () => {
    expect(resolveCollectionTimeZone({})).toBeUndefined();
  });

  it("returns no zone when the server answered both properties with an empty 404 propstat", () => {
    expect(resolveCollectionTimeZone({ calendarTimezone: {}, calendarTimezoneId: {} })).toBeUndefined();
  });

  it("returns no zone when calendar-timezone holds no VTIMEZONE", () => {
    expect(resolveCollectionTimeZone({ calendarTimezone: vcalendarWith([]) })).toBeUndefined();
    expect(resolveCollectionTimeZone({ calendarTimezone: "" })).toBeUndefined();
  });
});
