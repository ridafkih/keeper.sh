import { describe, expect, it } from "vitest";
import { parseIcsCalendar } from "@keeper.sh/calendar/ics";
import { formatEventsAsIcal } from "../../src/utils/ical-format";
import type { CalendarEvent } from "../../src/utils/ical-format";

const SETTINGS = {
  customEventName: "Busy",
  excludeAllDayEvents: false,
  excludeFocusTime: false,
  excludeOutOfOffice: false,
  includeEventDescription: false,
  includeEventLocation: false,
  includeEventName: false,
};

const makeEvent = (overrides: Partial<CalendarEvent>): CalendarEvent => ({
  availability: "busy",
  calendarId: "calendar-id",
  calendarName: "Work",
  description: null,
  endTime: new Date("2027-03-08T17:00:00.000Z"),
  exceptionDates: null,
  id: "event-id",
  isAllDay: false,
  location: null,
  recurrenceDuration: null,
  recurrenceId: null,
  recurrenceRule: null,
  sourceEventUid: null,
  startTime: new Date("2027-03-08T16:00:00.000Z"),
  title: "Test Event",
  ...overrides,
});

interface ParsedRange {
  end: Date | null;
  start: Date;
}

const expectPositiveSpan = (range: ParsedRange | undefined): void => {
  if (!range?.end) {
    throw new Error("Expected the feed to publish a range with both endpoints");
  }
  expect(range.end.getTime()).toBeGreaterThan(range.start.getTime());
};

const stripStamps = (ics: string): string =>
  ics.replaceAll(/DTSTAMP:\d{8}T\d{6}Z/g, "DTSTAMP:REDACTED");

const readEventDuration = (ics: string) => {
  const [event] = parseIcsCalendar({ icsString: ics }).events ?? [];
  if (!event || !("duration" in event)) {
    return null;
  }
  return event.duration ?? null;
};

const readRanges = (ics: string): ParsedRange[] => {
  const calendar = parseIcsCalendar({ icsString: ics });
  return (calendar.events ?? []).flatMap((event): ParsedRange[] => {
    if (!event.start?.date) {
      return [];
    }
    if ("end" in event && event.end?.date) {
      return [{ end: event.end.date, start: event.start.date }];
    }
    return [{ end: null, start: event.start.date }];
  });
};

const WEEKLY = { count: 3, frequency: "WEEKLY" } as const;

describe("published ical feed for degenerate recurring rows", () => {
  it("emits a readable range for a zero-duration series carried by DTSTART and DTEND", () => {
    const ics = formatEventsAsIcal([makeEvent({
      endTime: new Date("2027-03-08T16:00:00.000Z"),
      recurrenceRule: WEEKLY,
      sourceEventUid: "series-1",
      startTime: new Date("2027-03-08T16:00:00.000Z"),
    })], SETTINGS);

    const [range] = readRanges(ics);

    expectPositiveSpan(range);
  });

  it("publishes a positive span for a series carried by a zero DURATION", () => {
    const ics = formatEventsAsIcal([makeEvent({
      endTime: new Date("2027-03-08T16:00:00.000Z"),
      recurrenceDuration: { seconds: 0 },
      recurrenceRule: WEEKLY,
      sourceEventUid: "series-2",
      startTime: new Date("2027-03-08T16:00:00.000Z"),
    })], SETTINGS);

    const duration = readEventDuration(ics);
    const publishesZeroLengthSpan = duration !== null
      && Object.values(duration).every((part) => !part);

    expect(publishesZeroLengthSpan).toBe(false);
  });

  it("emits a conformant range for a degenerate override of a well-formed series", () => {
    const ics = formatEventsAsIcal([
      makeEvent({
        id: "master-id",
        recurrenceRule: WEEKLY,
        sourceEventUid: "series-3",
      }),
      makeEvent({
        endTime: new Date("2027-03-15T16:00:00.000Z"),
        id: "override-id",
        recurrenceId: new Date("2027-03-15T16:00:00.000Z"),
        sourceEventUid: "series-3",
        startTime: new Date("2027-03-15T16:00:00.000Z"),
      }),
    ], SETTINGS);

    for (const range of readRanges(ics)) {
      expectPositiveSpan(range);
    }
  });

  it("emits a conformant range for a degenerate row whose all-day flag was never recorded", () => {
    const ics = formatEventsAsIcal([makeEvent({
      endTime: new Date("2027-03-08T00:00:00.000Z"),
      isAllDay: null,
      startTime: new Date("2027-03-08T00:00:00.000Z"),
    })], SETTINGS);

    const [range] = readRanges(ics);

    expectPositiveSpan(range);
  });

  it("emits a conformant range for a degenerate row anchored in a zone", () => {
    const ics = formatEventsAsIcal([makeEvent({
      endTime: new Date("2027-03-08T16:00:00.000Z"),
      startTime: new Date("2027-03-08T16:00:00.000Z"),
      startTimeZone: "America/New_York",
    })], SETTINGS);

    const [range] = readRanges(ics);

    expectPositiveSpan(range);
  });

  it("renders the same bytes for every degenerate shape on a repeated generation", () => {
    const events = [
      makeEvent({
        endTime: new Date("2027-03-08T16:00:00.000Z"),
        id: "a",
        startTime: new Date("2027-03-08T16:00:00.000Z"),
      }),
      makeEvent({
        endTime: new Date("2027-03-05T00:00:00.000Z"),
        id: "b",
        isAllDay: true,
        startTime: new Date("2027-03-10T00:00:00.000Z"),
      }),
      makeEvent({
        endTime: new Date("2027-03-12T15:00:00.000Z"),
        id: "c",
        startTime: new Date("2027-03-12T16:00:00.000Z"),
      }),
    ];

    expect(stripStamps(formatEventsAsIcal(events, SETTINGS)))
      .toBe(stripStamps(formatEventsAsIcal(events, SETTINGS)));
  });
});
