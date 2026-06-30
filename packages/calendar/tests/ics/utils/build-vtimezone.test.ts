import { describe, expect, it } from "vitest";
import { generateIcsCalendar } from "ts-ics";
import type { IcsCalendar } from "ts-ics";
import { buildVtimezone } from "../../../src/ics/utils/build-vtimezone";

/**
 * Render a timezone to its serialized VTIMEZONE block so assertions run against
 * the real ts-ics output (the bytes Outlook actually reads), not the model.
 */
const renderVtimezone = (timezone: string, reference: Date): string => {
  const tz = buildVtimezone(timezone, reference);
  if (!tz) {
    return "";
  }
  const calendar: IcsCalendar = {
    version: "2.0",
    prodId: "-//Test//Test//EN",
    timezones: [tz],
    events: [],
  };
  return generateIcsCalendar(calendar);
};

const SUMMER_2026 = new Date("2026-06-17T12:00:00.000Z");

describe("buildVtimezone", () => {
  it("emits a northern-hemisphere DST zone with last-Sunday rules (Europe/Berlin)", () => {
    const ics = renderVtimezone("Europe/Berlin", SUMMER_2026);

    expect(ics).toContain("BEGIN:VTIMEZONE");
    expect(ics).toContain("TZID:Europe/Berlin");

    // Daylight onset: last Sunday of March, +01:00 -> +02:00.
    expect(ics).toContain("BEGIN:DAYLIGHT");
    expect(ics).toContain("TZOFFSETFROM:+0100");
    expect(ics).toContain("TZOFFSETTO:+0200");
    expect(ics).toContain("RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3");
    expect(ics).toContain("DTSTART:20260329T020000");

    // Standard onset: last Sunday of October, +02:00 -> +01:00.
    expect(ics).toContain("BEGIN:STANDARD");
    expect(ics).toContain("TZOFFSETFROM:+0200");
    expect(ics).toContain("TZOFFSETTO:+0100");
    expect(ics).toContain("RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10");
    expect(ics).toContain("DTSTART:20261025T030000");
  });

  it("emits nth-Sunday rules for America/New_York", () => {
    const ics = renderVtimezone("America/New_York", SUMMER_2026);

    expect(ics).toContain("TZID:America/New_York");
    // Daylight: 2nd Sunday of March, -05:00 -> -04:00.
    expect(ics).toContain("TZOFFSETFROM:-0500");
    expect(ics).toContain("TZOFFSETTO:-0400");
    expect(ics).toContain("RRULE:FREQ=YEARLY;BYDAY=2SU;BYMONTH=3");
    expect(ics).toContain("DTSTART:20260308T020000");
    // Standard: 1st Sunday of November, -04:00 -> -05:00.
    expect(ics).toContain("RRULE:FREQ=YEARLY;BYDAY=1SU;BYMONTH=11");
    expect(ics).toContain("DTSTART:20261101T020000");
  });

  it("classifies southern-hemisphere transitions by offset direction, not calendar order (Australia/Sydney)", () => {
    const ics = renderVtimezone("Australia/Sydney", SUMMER_2026);

    expect(ics).toContain("TZID:Australia/Sydney");
    // Daylight starts in October (+10:00 -> +11:00), standard resumes in April.
    const daylight = ics.slice(ics.indexOf("BEGIN:DAYLIGHT"), ics.indexOf("END:DAYLIGHT"));
    const standard = ics.slice(ics.indexOf("BEGIN:STANDARD"), ics.indexOf("END:STANDARD"));
    expect(daylight).toContain("TZOFFSETTO:+1100");
    expect(daylight).toContain("BYMONTH=10");
    expect(standard).toContain("TZOFFSETTO:+1000");
    expect(standard).toContain("BYMONTH=4");
  });

  it("emits a single fixed-offset STANDARD observance for a no-DST zone (America/Montevideo)", () => {
    const ics = renderVtimezone("America/Montevideo", SUMMER_2026);

    expect(ics).toContain("TZID:America/Montevideo");
    expect(ics).toContain("BEGIN:STANDARD");
    expect(ics).toContain("TZOFFSETFROM:-0300");
    expect(ics).toContain("TZOFFSETTO:-0300");
    expect(ics).not.toContain("BEGIN:DAYLIGHT");
    expect(ics).not.toContain("RRULE");
  });

  it("normalizes Windows timezone identifiers before building (W. Europe Standard Time)", () => {
    const ics = renderVtimezone("W. Europe Standard Time", SUMMER_2026);
    expect(ics).toContain("TZID:Europe/Berlin");
  });

  it("returns undefined for an unresolvable timezone", () => {
    expect(buildVtimezone("Not/AZone", SUMMER_2026)).toBeUndefined();
  });

  it("returns undefined for an empty timezone", () => {
    expect(buildVtimezone("", SUMMER_2026)).toBeUndefined();
  });

  it("uses the resolved IANA id as the VTIMEZONE id", () => {
    const tz = buildVtimezone("Europe/Berlin", SUMMER_2026);
    expect(tz?.id).toBe("Europe/Berlin");
  });
});
