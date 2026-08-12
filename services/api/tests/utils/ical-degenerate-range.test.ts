import { describe, expect, it } from "vitest";
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
  id: "test-event-id",
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

const readProperty = (ics: string, name: string): string => {
  const line = ics
    .split("\r\n")
    .find((candidate) => candidate.startsWith(`${name}:`) || candidate.startsWith(`${name};`));
  if (!line) {
    throw new Error(`Expected the feed to carry a ${name}`);
  }
  return line;
};

const readValue = (ics: string, name: string): string => {
  const line = readProperty(ics, name);
  const value = line.slice(line.lastIndexOf(":") + 1);
  if (value.length === 0) {
    throw new Error(`Expected ${name} to carry a value`);
  }
  return value;
};

describe("published ical feed for a degenerate time range", () => {
  it.each([
    {
      endTime: new Date("2027-03-08T16:00:00.000Z"),
      isAllDay: false,
      name: "zero-duration timed event",
      startTime: new Date("2027-03-08T16:00:00.000Z"),
    },
    {
      endTime: new Date("2027-03-08T15:00:00.000Z"),
      isAllDay: false,
      name: "inverted timed event",
      startTime: new Date("2027-03-08T16:00:00.000Z"),
    },
    {
      endTime: new Date("2027-03-08T00:00:00.000Z"),
      isAllDay: true,
      name: "same-date all-day event",
      startTime: new Date("2027-03-08T00:00:00.000Z"),
    },
    {
      endTime: new Date("2027-03-05T00:00:00.000Z"),
      isAllDay: true,
      name: "inverted all-day event",
      startTime: new Date("2027-03-10T00:00:00.000Z"),
    },
  ])("emits a conformant DTSTART/DTEND pair for a $name", ({ endTime, isAllDay, startTime }) => {
    const ics = formatEventsAsIcal([makeEvent({ endTime, isAllDay, startTime })], SETTINGS);

    expect(readValue(ics, "DTEND") > readValue(ics, "DTSTART")).toBe(true);
  });

  it("keeps a well-formed range untouched", () => {
    const ics = formatEventsAsIcal([makeEvent({})], SETTINGS);

    expect(readValue(ics, "DTSTART")).toBe("20270308T160000Z");
    expect(readValue(ics, "DTEND")).toBe("20270308T170000Z");
  });

  it("renders the same feed on every generation", () => {
    const event = makeEvent({
      endTime: new Date("2027-03-08T16:00:00.000Z"),
      startTime: new Date("2027-03-08T16:00:00.000Z"),
    });

    const first = formatEventsAsIcal([event], SETTINGS);
    const second = formatEventsAsIcal([event], SETTINGS);

    expect(first).toBe(second);
  });
});
