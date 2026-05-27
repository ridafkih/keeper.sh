import { describe, expect, it } from "vitest";
import { generateIcsCalendar } from "ts-ics";
import type { IcsCalendar } from "ts-ics";
import { buildZonedIcsDate, formatTzOffset } from "../../../src/ics/utils/build-zoned-date";

const renderDtstart = (instant: Date, timezone: string | undefined, isAllDay: boolean): string => {
  const calendar: IcsCalendar = {
    events: [
      {
        uid: "uid",
        summary: "Test",
        stamp: { date: new Date("2026-01-01T00:00:00.000Z") },
        start: buildZonedIcsDate(instant, timezone, isAllDay),
        end: buildZonedIcsDate(instant, timezone, isAllDay),
      },
    ],
    prodId: "-//Test//Test//EN",
    version: "2.0",
  };
  const line = generateIcsCalendar(calendar)
    .split("\r\n")
    .find((value) => value.startsWith("DTSTART"));
  return line ?? "";
};

describe("buildZonedIcsDate", () => {
  it("attaches the local timezone for a timed event", () => {
    const result = buildZonedIcsDate(new Date("2026-06-17T10:45:00.000Z"), "America/Montevideo", false);

    expect(result.date.toISOString()).toBe("2026-06-17T10:45:00.000Z");
    expect(result.local?.timezone).toBe("America/Montevideo");
    expect(result.local?.tzoffset).toBe("-03:00");
    // The local wall clock is encoded in the UTC fields of `local.date`.
    expect(result.local?.date.toISOString()).toBe("2026-06-17T07:45:00.000Z");
    expect(result.type).toBeUndefined();
  });

  it("renders a TZID-qualified DTSTART", () => {
    expect(renderDtstart(new Date("2026-06-17T10:45:00.000Z"), "America/Montevideo", false)).toBe(
      "DTSTART;TZID=America/Montevideo:20260617T074500",
    );
  });

  it("honors daylight-saving offsets via the IANA database", () => {
    // New York is UTC-4 in July (EDT).
    const summer = buildZonedIcsDate(new Date("2026-07-01T16:00:00.000Z"), "America/New_York", false);
    expect(summer.local?.tzoffset).toBe("-04:00");
    expect(summer.local?.date.toISOString()).toBe("2026-07-01T12:00:00.000Z");

    // New York is UTC-5 in January (EST).
    const winter = buildZonedIcsDate(new Date("2026-01-01T17:00:00.000Z"), "America/New_York", false);
    expect(winter.local?.tzoffset).toBe("-05:00");
    expect(winter.local?.date.toISOString()).toBe("2026-01-01T12:00:00.000Z");
  });

  it("maps Windows timezone identifiers to IANA before zoning", () => {
    const result = buildZonedIcsDate(new Date("2026-06-17T10:45:00.000Z"), "Montevideo Standard Time", false);
    expect(result.local?.timezone).toBe("America/Montevideo");
  });

  it("keeps all-day events timezone-less", () => {
    const result = buildZonedIcsDate(new Date("2026-03-08T00:00:00.000Z"), "America/Montevideo", true);
    expect(result.type).toBe("DATE");
    expect(result.local).toBeUndefined();
  });

  it("falls back to a bare UTC datetime without a timezone", () => {
    const result = buildZonedIcsDate(new Date("2026-06-17T10:45:00.000Z"), undefined, false);
    expect(result.local).toBeUndefined();
    expect(result.type).toBeUndefined();
  });

  it("falls back to a bare UTC datetime for an unresolvable timezone", () => {
    const result = buildZonedIcsDate(new Date("2026-06-17T10:45:00.000Z"), "Not/AZone", false);
    expect(result.local).toBeUndefined();
  });
});

describe("formatTzOffset", () => {
  it("formats negative offsets", () => {
    expect(formatTzOffset(-3 * 60 * 60 * 1000)).toBe("-03:00");
  });

  it("formats positive offsets with minutes", () => {
    expect(formatTzOffset(5 * 60 * 60 * 1000 + 30 * 60 * 1000)).toBe("+05:30");
  });

  it("formats zero as a positive offset", () => {
    expect(formatTzOffset(0)).toBe("+00:00");
  });
});
