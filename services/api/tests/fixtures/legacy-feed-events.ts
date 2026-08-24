import type { CalendarEvent } from "../../src/utils/ical-format";

interface FeedEvent extends CalendarEvent {
  sourceEventType: string | null;
}

const LEGACY_FEED_SETTINGS = {
  includeEventName: false,
  includeEventDescription: false,
  includeEventLocation: false,
  excludeAllDayEvents: false,
  customEventName: "Busy",
};

const makeFeedEvent = (overrides: Partial<FeedEvent> = {}): FeedEvent => ({
  id: "event-id",
  calendarId: "calendar-work",
  availability: "busy",
  title: "Test Event",
  description: null,
  location: null,
  startTime: new Date("2026-03-28T00:00:00.000Z"),
  endTime: new Date("2026-03-29T00:00:00.000Z"),
  isAllDay: false,
  calendarName: "Work",
  recurrenceRule: null,
  recurrenceDuration: null,
  exceptionDates: null,
  recurrenceId: null,
  sourceEventUid: null,
  startTimeZone: null,
  sourceEventType: null,
  ...overrides,
});

const LEGACY_FEED_EVENTS: FeedEvent[] = [
  makeFeedEvent({
    id: "recurring-master",
    calendarId: "calendar-work",
    sourceEventUid: "weekly-series",
    startTime: new Date("2026-06-17T10:45:00.000Z"),
    endTime: new Date("2026-06-17T11:45:00.000Z"),
    startTimeZone: "Europe/Berlin",
    recurrenceRule: { frequency: "WEEKLY" } as never,
    exceptionDates: [{ date: new Date("2026-07-01T10:45:00.000Z"), type: "DATE-TIME" }] as never,
  }),
  makeFeedEvent({
    id: "all-day-override",
    calendarId: "calendar-work",
    sourceEventUid: "weekly-series",
    isAllDay: true,
    recurrenceId: new Date("2026-06-24T10:45:00.000Z"),
    startTime: new Date("2026-06-24T00:00:00.000Z"),
    endTime: new Date("2026-06-25T00:00:00.000Z"),
  }),
  makeFeedEvent({
    id: "explicit-all-day",
    calendarId: "calendar-work",
    isAllDay: true,
    startTime: new Date("2026-04-01T00:00:00.000Z"),
    endTime: new Date("2026-04-02T00:00:00.000Z"),
  }),
  makeFeedEvent({
    id: "inferred-all-day",
    calendarId: "calendar-personal",
    calendarName: "Personal",
    isAllDay: null,
    startTime: new Date("2026-04-03T00:00:00.000Z"),
    endTime: new Date("2026-04-04T00:00:00.000Z"),
  }),
  makeFeedEvent({
    id: "free-event",
    calendarId: "calendar-personal",
    calendarName: "Personal",
    availability: "free",
    startTime: new Date("2026-04-06T09:00:00.000Z"),
    endTime: new Date("2026-04-06T10:00:00.000Z"),
  }),
  makeFeedEvent({
    id: "detailed-event",
    calendarId: "calendar-personal",
    calendarName: "Personal",
    title: "Dentist",
    description: "Bring the referral letter",
    location: "12 Example Street",
    startTime: new Date("2026-04-07T15:00:00.000Z"),
    endTime: new Date("2026-04-07T16:00:00.000Z"),
    startTimeZone: "America/New_York",
  }),
  makeFeedEvent({
    id: "focus-block",
    calendarId: "calendar-work",
    title: "Focus time",
    sourceEventType: "focusTime",
    startTime: new Date("2026-04-08T13:00:00.000Z"),
    endTime: new Date("2026-04-08T15:00:00.000Z"),
  }),
  makeFeedEvent({
    id: "away-block",
    calendarId: "calendar-work",
    title: "Annual leave",
    availability: "oof",
    startTime: new Date("2026-04-09T08:00:00.000Z"),
    endTime: new Date("2026-04-09T17:00:00.000Z"),
  }),
];

const LEGACY_FEED_CALENDAR_IDS = ["calendar-work", "calendar-personal"];

export {
  LEGACY_FEED_CALENDAR_IDS,
  LEGACY_FEED_EVENTS,
  LEGACY_FEED_SETTINGS,
  makeFeedEvent,
};
export type { FeedEvent };
