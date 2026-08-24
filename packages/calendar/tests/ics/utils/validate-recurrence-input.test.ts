import { describe, expect, it } from "vitest";
import {
  assertNoUnsupportedRecurrenceDates,
  collectRecurrenceDateEventUids,
  resolveRecurrenceTimeZones,
} from "../../../src/ics/utils/validate-recurrence-input";
import { readDeclaredTimeZoneOffsets } from "../../../src/ics/utils/resolve-timezone-identifier";

describe("assertNoUnsupportedRecurrenceDates", () => {
  it("rejects folded RDATE properties inside VEVENT", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "RDATE;VALUE=DATE:20260701,",
      " 20260702",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    expect(() => assertNoUnsupportedRecurrenceDates(ics))
      .toThrow("ICS RDATE recurrence is not supported");
  });

  it("allows RDATE inside VTIMEZONE observances supported by ts-ics", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VTIMEZONE",
      "BEGIN:STANDARD",
      "RDATE:20260701T000000",
      "END:STANDARD",
      "END:VTIMEZONE",
      "END:VCALENDAR",
    ].join("\r\n");

    expect(() => assertNoUnsupportedRecurrenceDates(ics)).not.toThrow();
  });

  it("fails closed when a mismatched component boundary tries to hide event RDATE", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "END:VALARM",
      "RDATE:20260701T090000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    expect(() => assertNoUnsupportedRecurrenceDates(ics))
      .toThrow("expected END:VEVENT, received END:VALARM");
  });
});

describe("collectRecurrenceDateEventUids", () => {
  it("attributes RDATE to the event that declared it", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:with-rdate@test",
      "RDATE;VALUE=DATE:20260701,",
      " 20260702",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:without-rdate@test",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    expect(collectRecurrenceDateEventUids(ics)).toEqual(["with-rdate@test"]);
  });

  it("does not leak RDATE onto the next event when components are adjacent", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "RDATE:20260701T090000Z",
      "UID:first@test",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:second@test",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    expect(collectRecurrenceDateEventUids(ics)).toEqual(["first@test"]);
  });

  it("ignores RDATE inside VTIMEZONE observances supported by ts-ics", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VTIMEZONE",
      "TZID:Custom/Zone",
      "BEGIN:STANDARD",
      "RDATE:20260701T000000",
      "END:STANDARD",
      "END:VTIMEZONE",
      "BEGIN:VEVENT",
      "UID:event@test",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    expect(collectRecurrenceDateEventUids(ics)).toEqual([]);
  });
});

const buildCalendar = (timeZoneId: string, observances: string[]): string => [
  "BEGIN:VCALENDAR",
  "BEGIN:VTIMEZONE",
  `TZID:${timeZoneId}`,
  ...observances,
  "END:VTIMEZONE",
  "END:VCALENDAR",
].join("\r\n");

const FIXED_OFFSET_OBSERVANCES = [
  "BEGIN:STANDARD",
  "DTSTART:19700101T000000",
  "TZOFFSETFROM:-0500",
  "TZOFFSETTO:-0500",
  "END:STANDARD",
];

const DAYLIGHT_OBSERVANCES = [
  "BEGIN:STANDARD",
  "DTSTART:19701101T020000",
  "TZOFFSETFROM:-0600",
  "TZOFFSETTO:-0700",
  "END:STANDARD",
  "BEGIN:DAYLIGHT",
  "DTSTART:19700308T020000",
  "TZOFFSETFROM:-0700",
  "TZOFFSETTO:-0600",
  "END:DAYLIGHT",
];

const recurringEvent = (uid: string, startTimeZone: string) => ({
  recurrenceRule: { frequency: "DAILY" as const },
  startTimeZone,
  uid,
});

describe("resolveRecurrenceTimeZones", () => {
  it("leaves a single event with an unrecognised timezone untouched", () => {
    const declared = readDeclaredTimeZoneOffsets(
      buildCalendar("Customized Time Zone", DAYLIGHT_OBSERVANCES),
    );

    const result = resolveRecurrenceTimeZones(
      [{ startTimeZone: "Customized Time Zone", uid: "single@test" }],
      declared,
    );

    expect(result.unsupportedUids).toEqual([]);
    expect(result.events[0]?.startTimeZone).toBe("Customized Time Zone");
  });

  it("recovers the IANA zone carried by a tzurl-style identifier", () => {
    const identifier = "/mozilla.org/20050126_1/America/Denver";
    const declared = readDeclaredTimeZoneOffsets(
      buildCalendar(identifier, DAYLIGHT_OBSERVANCES),
    );

    const result = resolveRecurrenceTimeZones(
      [recurringEvent("thunderbird@test", identifier)],
      declared,
    );

    expect(result.unsupportedUids).toEqual([]);
    expect(result.events[0]?.startTimeZone).toBe("America/Denver");
  });

  it("falls back to the declared offset when a VTIMEZONE never changes offset", () => {
    const declared = readDeclaredTimeZoneOffsets(
      buildCalendar("Customized Time Zone", FIXED_OFFSET_OBSERVANCES),
    );

    const result = resolveRecurrenceTimeZones(
      [recurringEvent("exchange@test", "Customized Time Zone")],
      declared,
    );

    expect(result.unsupportedUids).toEqual([]);
    expect(result.events[0]?.startTimeZone).toBe("Etc/GMT+5");
  });

  it("refuses to flatten a DST timezone onto a fixed offset", () => {
    const label = "(UTC-07:00) Mountain Time (US & Canada)";
    const declared = readDeclaredTimeZoneOffsets(
      buildCalendar(label, DAYLIGHT_OBSERVANCES),
    );

    const result = resolveRecurrenceTimeZones(
      [recurringEvent("exchange-dst@test", label)],
      declared,
    );

    expect(result.unsupportedUids).toEqual(["exchange-dst@test"]);
    expect(result.events[0]?.startTimeZone).toBe(label);
  });

  it("keeps Windows identifiers resolving through the IANA mapping", () => {
    const declared = readDeclaredTimeZoneOffsets(
      buildCalendar("Mountain Standard Time", DAYLIGHT_OBSERVANCES),
    );

    const result = resolveRecurrenceTimeZones(
      [recurringEvent("windows@test", "America/Denver")],
      declared,
    );

    expect(result.unsupportedUids).toEqual([]);
    expect(result.events[0]?.startTimeZone).toBe("America/Denver");
  });
});
