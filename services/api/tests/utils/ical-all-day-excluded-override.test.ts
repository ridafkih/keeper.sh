import { describe, expect, it } from "vitest";
import ICAL from "ical.js";
import { formatEventsAsIcal } from "../../src/utils/ical-format";
import type { CalendarEvent, FeedSettings } from "../../src/utils/ical-format";

const SETTINGS: FeedSettings = {
  includeEventName: false,
  includeEventDescription: false,
  includeEventLocation: false,
  excludeAllDayEvents: false,
  excludeFocusTime: false,
  excludeOutOfOffice: true,
  customEventName: "Busy",
  feedName: "Work",
};

const makeEvent = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: "event-id",
  calendarId: "calendar-id",
  availability: "busy",
  title: "Event",
  description: null,
  location: null,
  startTime: new Date("2026-03-30T00:00:00.000Z"),
  endTime: new Date("2026-03-31T00:00:00.000Z"),
  isAllDay: false,
  calendarName: "Work",
  recurrenceRule: null,
  recurrenceDuration: null,
  exceptionDates: null,
  recurrenceId: null,
  sourceEventUid: null,
  ...overrides,
});

const allDayWeeklyMaster = (overrides: Partial<CalendarEvent> = {}): CalendarEvent =>
  makeEvent({
    id: "all-day-master",
    isAllDay: true,
    recurrenceRule: { frequency: "WEEKLY" },
    sourceEventUid: "all-day-series",
    startTime: new Date("2026-03-30T00:00:00.000Z"),
    endTime: new Date("2026-03-31T00:00:00.000Z"),
    ...overrides,
  });

const excludedAllDayOverride = makeEvent({
  id: "all-day-out-of-office",
  isAllDay: true,
  sourceEventType: "outOfOffice",
  sourceEventUid: "all-day-series",
  recurrenceId: new Date("2026-04-06T00:00:00.000Z"),
  startTime: new Date("2026-04-06T00:00:00.000Z"),
  endTime: new Date("2026-04-07T00:00:00.000Z"),
});

const exceptionDateLines = (ics: string): string[] =>
  ics.split("\r\n").filter((line) => line.startsWith("EXDATE"));

const expandOccurrenceDays = (ics: string, count: number): string[] => {
  const component = new ICAL.Component(ICAL.parse(ics));
  const [vevent] = component.getAllSubcomponents("vevent");
  if (!vevent) {
    throw new Error("feed has no VEVENT");
  }
  const event = new ICAL.Event(vevent);
  const iterator = event.iterator();
  const days: string[] = [];
  for (let next = iterator.next(); next && days.length < count; next = iterator.next()) {
    days.push(next.toString());
  }
  return days;
};

const exceptionValuesAreDates = (ics: string): boolean[] => {
  const component = new ICAL.Component(ICAL.parse(ics));
  const [vevent] = component.getAllSubcomponents("vevent");
  if (!vevent) {
    throw new Error("feed has no VEVENT");
  }
  return vevent
    .getAllProperties("exdate")
    .flatMap((property) => property.getValues())
    .map((value) => value instanceof ICAL.Time && value.isDate);
};

describe("EXDATE value type under an all-day master", () => {
  it("writes an excluded override of an all-day master as a DATE EXDATE", () => {
    const ics = formatEventsAsIcal([allDayWeeklyMaster(), excludedAllDayOverride], SETTINGS);

    expect(ics).toContain("DTSTART;VALUE=DATE:20260330");
    expect(exceptionDateLines(ics)).toEqual(["EXDATE;VALUE=DATE:20260406"]);
    expect(exceptionValuesAreDates(ics)).toEqual([true]);
    expect(expandOccurrenceDays(ics, 3)).toEqual(["2026-03-30", "2026-04-13", "2026-04-20"]);
  });

  it("writes a source exception without a value type under an all-day master as a DATE EXDATE", () => {
    const ics = formatEventsAsIcal(
      [allDayWeeklyMaster({ exceptionDates: [{ date: new Date("2026-04-13T00:00:00.000Z") }] })],
      SETTINGS,
    );

    expect(exceptionDateLines(ics)).toEqual(["EXDATE;VALUE=DATE:20260413"]);
    expect(exceptionValuesAreDates(ics)).toEqual([true]);
    expect(expandOccurrenceDays(ics, 3)).toEqual(["2026-03-30", "2026-04-06", "2026-04-20"]);
  });

  it("writes both a source exception and an excluded override as DATE EXDATEs", () => {
    const ics = formatEventsAsIcal(
      [
        allDayWeeklyMaster({ exceptionDates: [{ date: new Date("2026-04-13T00:00:00.000Z") }] }),
        excludedAllDayOverride,
      ],
      SETTINGS,
    );

    expect(exceptionDateLines(ics)).toEqual([
      "EXDATE;VALUE=DATE:20260413",
      "EXDATE;VALUE=DATE:20260406",
    ]);
    expect(exceptionValuesAreDates(ics)).toEqual([true, true]);
    expect(expandOccurrenceDays(ics, 3)).toEqual(["2026-03-30", "2026-04-20", "2026-04-27"]);
  });

  it("keeps the TZID-qualified EXDATE of an excluded override under a timed master", () => {
    const ics = formatEventsAsIcal(
      [
        makeEvent({
          id: "timed-master",
          recurrenceRule: { frequency: "WEEKLY" },
          sourceEventUid: "timed-series",
          startTimeZone: "America/Edmonton",
          startTime: new Date("2026-03-30T15:00:00.000Z"),
          endTime: new Date("2026-03-30T16:00:00.000Z"),
        }),
        makeEvent({
          id: "timed-out-of-office",
          sourceEventType: "outOfOffice",
          sourceEventUid: "timed-series",
          startTimeZone: "America/Edmonton",
          recurrenceId: new Date("2026-04-06T15:00:00.000Z"),
          startTime: new Date("2026-04-06T15:00:00.000Z"),
          endTime: new Date("2026-04-06T16:00:00.000Z"),
        }),
      ],
      SETTINGS,
    );

    expect(exceptionDateLines(ics)).toEqual(["EXDATE;TZID=America/Edmonton:20260406T090000"]);
    expect(exceptionValuesAreDates(ics)).toEqual([false]);
    expect(expandOccurrenceDays(ics, 3)).toEqual([
      "2026-03-30T09:00:00",
      "2026-04-13T09:00:00",
      "2026-04-20T09:00:00",
    ]);
  });
});
