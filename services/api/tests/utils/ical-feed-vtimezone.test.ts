import { describe, expect, it } from "vitest";
import { buildFeedIcalDocument, formatEventsAsIcal } from "../../src/utils/ical-format";
import type { CalendarEvent, FeedSettings } from "../../src/utils/ical-format";
import { WINDOWS_TO_IANA } from "../../../../packages/calendar/src/ics/utils/windows-timezones";
import { IANA_LINK_TARGETS } from "../../../../packages/calendar/src/ics/utils/timezone-links";

const SETTINGS: FeedSettings = {
  includeEventName: true,
  includeEventDescription: false,
  includeEventLocation: false,
  excludeAllDayEvents: false,
  excludeFocusTime: false,
  excludeOutOfOffice: false,
  customEventName: "Busy",
};

const HOUR_MS = 60 * 60 * 1000;
const EXHAUSTIVE_SWEEP = process.env.CALENDAR_TZ_SWEEP_EXHAUSTIVE === "1";
const SWEEP_SAMPLE_STRIDE = 8;
const SWEEP_TIMEOUT_MS = 300_000;

const makeEvent = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: "event",
  calendarId: "calendar",
  availability: "busy",
  title: "Appointment",
  description: null,
  location: null,
  startTime: new Date("2026-11-24T16:00:00Z"),
  endTime: new Date("2026-11-24T17:00:00Z"),
  isAllDay: false,
  calendarName: "Home",
  recurrenceRule: null,
  recurrenceDuration: null,
  exceptionDates: null,
  recurrenceId: null,
  sourceEventUid: null,
  startTimeZone: null,
  ...overrides,
});

const unfold = (ics: string): string[] => ics.replaceAll(/\r\n[ \t]/g, "").split("\r\n");

const readComponentTimeZoneIds = (ics: string): string[] =>
  unfold(ics).filter((line) => line.startsWith("TZID:")).map((line) => line.slice("TZID:".length));

const readReferencedTimeZoneIds = (ics: string): string[] =>
  unfold(ics).flatMap((line) => [...line.matchAll(/;TZID=([^:;]+)/g)].map(([, timeZone]) => timeZone ?? ""));

const readTimeZonesWithoutComponent = (ics: string): string[] => {
  const declared = new Set(readComponentTimeZoneIds(ics));
  return [...new Set(readReferencedTimeZoneIds(ics))].filter((timeZone) => !declared.has(timeZone));
};

const readEventLines = (ics: string): string[] => {
  const lines = unfold(ics);
  return lines.slice(lines.indexOf("BEGIN:VEVENT"));
};

const readProperty = (ics: string, name: string): string | undefined =>
  readEventLines(ics).find((line) => line.startsWith(`${name}:`) || line.startsWith(`${name};`));

describe("feed VTIMEZONE coverage", () => {
  it("declares America/Chicago for an iCloud event written with that TZID", () => {
    const ics = formatEventsAsIcal([makeEvent({ startTimeZone: "America/Chicago" })], SETTINGS);

    expect(readProperty(ics, "DTSTART")).toBe("DTSTART;TZID=America/Chicago:20261124T100000");
    expect(readComponentTimeZoneIds(ics)).toEqual(["America/Chicago"]);
  });

  it("declares the zone of a DTEND even when its DTSTART falls in the repeated fall-back hour", () => {
    const startTime = new Date("2026-11-01T07:30:00Z");
    const ics = formatEventsAsIcal([
      makeEvent({ startTime, endTime: new Date(startTime.getTime() + HOUR_MS), startTimeZone: "America/Chicago" }),
    ], SETTINGS);

    expect(readProperty(ics, "DTSTART")).toBe("DTSTART:20261101T073000Z");
    expect(readProperty(ics, "DTEND")).toBe("DTEND;TZID=America/Chicago:20261101T023000");
    expect(readTimeZonesWithoutComponent(ics)).toEqual([]);
  });

  it.each([
    ["US/Central"],
    ["america/chicago"],
    ["AMERICA/CHICAGO"],
    ["America/Chicago "],
    ["Central Standard Time"],
    ["/mozilla.org/20050126_1/America/Chicago"],
    ["/freeassociation.sourceforge.net/Tzfile/US/Central"],
  ])("writes %j as the canonical America/Chicago with its VTIMEZONE", (startTimeZone) => {
    const ics = formatEventsAsIcal([makeEvent({ startTimeZone })], SETTINGS);

    expect(readProperty(ics, "DTSTART")).toBe("DTSTART;TZID=America/Chicago:20261124T100000");
    expect(readProperty(ics, "DTEND")).toBe("DTEND;TZID=America/Chicago:20261124T110000");
    expect(readComponentTimeZoneIds(ics)).toEqual(["America/Chicago"]);
  });

  it("writes one VTIMEZONE when aliases of the same zone appear in one feed", () => {
    const ics = formatEventsAsIcal([
      makeEvent({ id: "first", startTimeZone: "America/Chicago" }),
      makeEvent({ id: "second", startTimeZone: "US/Central" }),
      makeEvent({ id: "third", startTimeZone: "Central Standard Time" }),
    ], SETTINGS);

    expect(new Set(readReferencedTimeZoneIds(ics))).toEqual(new Set(["America/Chicago"]));
    expect(readComponentTimeZoneIds(ics)).toEqual(["America/Chicago"]);
  });

  it("declares the master zone used by overrides and exception dates", () => {
    const masterStart = new Date("2026-11-02T16:00:00Z");
    const recurrenceId = new Date("2026-11-04T16:00:00Z");
    const ics = formatEventsAsIcal([
      makeEvent({
        id: "master",
        sourceEventUid: "series",
        startTime: masterStart,
        endTime: new Date(masterStart.getTime() + HOUR_MS),
        recurrenceRule: { frequency: "DAILY" },
        exceptionDates: [{ date: new Date("2026-11-03T16:00:00Z") }],
        startTimeZone: "US/Central",
      }),
      makeEvent({
        id: "override",
        sourceEventUid: "series",
        startTime: new Date(recurrenceId.getTime() + HOUR_MS),
        endTime: new Date(recurrenceId.getTime() + 2 * HOUR_MS),
        recurrenceId,
        startTimeZone: "Europe/London",
      }),
    ], SETTINGS);

    expect(readProperty(ics, "EXDATE")).toBe("EXDATE;TZID=America/Chicago:20261103T100000");
    expect(readProperty(ics, "RECURRENCE-ID")).toBe("RECURRENCE-ID;TZID=America/Chicago:20261104T100000");
    expect(readTimeZonesWithoutComponent(ics)).toEqual([]);
    expect(new Set(readComponentTimeZoneIds(ics))).toEqual(new Set(["America/Chicago", "Europe/London"]));
  });

  it("anchors each VTIMEZONE at the earliest instant written in that zone", () => {
    const ics = formatEventsAsIcal([
      makeEvent({ id: "recent", startTimeZone: "America/Chicago" }),
      makeEvent({
        id: "historic",
        startTime: new Date("2019-03-01T16:00:00Z"),
        endTime: new Date("2019-03-01T17:00:00Z"),
        startTimeZone: "America/Chicago",
      }),
    ], SETTINGS);

    const firstObservanceStart = unfold(ics).find((line) => line.startsWith("DTSTART:"));
    expect(firstObservanceStart).toBe("DTSTART:20170312T020000");
  });

  it("writes America/Chicago in the two-rule form Outlook reads correctly", () => {
    const ics = formatEventsAsIcal([makeEvent({ startTimeZone: "America/Chicago" })], SETTINGS);
    const lines = unfold(ics);
    const block = lines.slice(lines.indexOf("BEGIN:VTIMEZONE"), lines.indexOf("END:VTIMEZONE") + 1);

    expect(block).toEqual([
      "BEGIN:VTIMEZONE",
      "TZID:America/Chicago",
      "BEGIN:DAYLIGHT",
      "DTSTART:20240310T020000",
      "TZOFFSETFROM:-0600",
      "TZOFFSETTO:-0500",
      "RRULE:FREQ=YEARLY;BYDAY=2SU;BYMONTH=3",
      "END:DAYLIGHT",
      "BEGIN:STANDARD",
      "DTSTART:20241103T020000",
      "TZOFFSETFROM:-0500",
      "TZOFFSETTO:-0600",
      "RRULE:FREQ=YEARLY;BYDAY=1SU;BYMONTH=11",
      "END:STANDARD",
      "END:VTIMEZONE",
    ]);
  });

  it("gives every TZID it writes a VTIMEZONE across the zone names it accepts", () => {
    const identifiers = [
      ...Intl.supportedValuesOf("timeZone"),
      ...Object.keys(IANA_LINK_TARGETS),
      ...Object.keys(WINDOWS_TO_IANA),
    ].filter((_identifier, index) => EXHAUSTIVE_SWEEP || index % SWEEP_SAMPLE_STRIDE === 0);
    const uncovered = identifiers.filter((startTimeZone) =>
      readTimeZonesWithoutComponent(formatEventsAsIcal([makeEvent({ startTimeZone })], SETTINGS)).length > 0);

    expect(uncovered).toEqual([]);
  }, SWEEP_TIMEOUT_MS);

  it("counts served events whose time zone cannot be resolved", () => {
    const document = buildFeedIcalDocument([
      makeEvent({ id: "offset", startTimeZone: "GMT-0600" }),
      makeEvent({ id: "vague", startTimeZone: "Central" }),
      makeEvent({ id: "known", startTimeZone: "America/Chicago" }),
      makeEvent({ id: "floating", startTimeZone: null }),
    ], SETTINGS);

    expect(document.unresolvedTimeZoneEventCount).toBe(2);
    expect(readTimeZonesWithoutComponent(document.body)).toEqual([]);
  });
});
