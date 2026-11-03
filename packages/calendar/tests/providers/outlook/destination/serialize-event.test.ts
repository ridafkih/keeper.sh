import { describe, expect, it, vi } from "vitest";
import type { MaterializedSyncableEvent, SourceEvent } from "../../../../src/core/types";
import { serializeOutlookEvent } from "../../../../src/providers/outlook/destination/serialize-event";
import { parseEventTime } from "../../../../src/providers/outlook/shared/date-time";

const { mockPullRemoteCalendar } = vi.hoisted(() => ({
  mockPullRemoteCalendar: vi.fn<(...args: unknown[]) => Promise<{ ical: string }>>(),
}));
const { mockPrepareCalendarSnapshot } = vi.hoisted(() => ({
  mockPrepareCalendarSnapshot: vi.fn<(...args: unknown[]) => Promise<{ changed: boolean }>>(),
}));

vi.mock("../../../../src/ics/utils/pull-remote-calendar", () => ({
  pullRemoteCalendar: mockPullRemoteCalendar,
}));
vi.mock("../../../../src/ics/utils/create-snapshot", () => ({
  prepareCalendarSnapshot: mockPrepareCalendarSnapshot,
}));

const UTC_START = new Date("2026-12-01T13:00:00.000Z");
const UTC_END = new Date("2026-12-01T14:00:00.000Z");

const STORED_ZONE_LABELS = [
  "Customized Time Zone",
  "(UTC-07:00) Mountain Time (US & Canada)",
  "(UTC+08:00) Kuala Lumpur, Singapore",
  "/mozilla.org/20050126_1/America/Denver",
  "US/Eastern",
  "Asia/Calcutta",
  "Eastern Standard Time",
  "America/Edmonton",
  "America/New_York",
  "UTC",
];

const buildTimedEvent = (startTimeZone?: string): MaterializedSyncableEvent => ({
  calendarId: "calendar-id",
  calendarName: "Calendar",
  calendarUrl: null,
  endTime: UTC_END,
  id: "event-id",
  sourceEventUid: "source-uid",
  startTime: UTC_START,
  ...(startTimeZone && { startTimeZone }),
  summary: "Planning",
});

const toUtcGraphValue = (value: Date) => ({
  dateTime: value.toISOString().replace("Z", ""),
  timeZone: "UTC",
});

describe("serializeOutlookEvent", () => {
  it("serializes all-day working-elsewhere events with native availability", () => {
    const event = serializeOutlookEvent({
      availability: "workingElsewhere",
      calendarId: "calendar-id",
      calendarName: "Calendar",
      calendarUrl: null,
      endTime: new Date("2026-03-09T00:00:00.000Z"),
      id: "event-id",
      sourceEventUid: "source-uid",
      startTime: new Date("2026-03-08T00:00:00.000Z"),
      startTimeZone: "UTC",
      summary: "Working elsewhere",
    });

    expect(event.isAllDay).toBe(true);
    expect(event.showAs).toBe("workingElsewhere");
    expect(event.start).toEqual({ dateTime: "2026-03-08T00:00:00.000", timeZone: "UTC" });
    expect(event.end).toEqual({ dateTime: "2026-03-09T00:00:00.000", timeZone: "UTC" });
  });

  it("states all-day dates in UTC when the source carries a named timezone", () => {
    const event = serializeOutlookEvent({
      calendarId: "calendar-id",
      calendarName: "Calendar",
      calendarUrl: null,
      endTime: new Date("2026-03-09T00:00:00.000Z"),
      id: "event-id",
      isAllDay: true,
      sourceEventUid: "source-uid",
      startTime: new Date("2026-03-08T00:00:00.000Z"),
      startTimeZone: "America/Edmonton",
      summary: "All-day event",
    });

    expect(event.start).toEqual({
      dateTime: "2026-03-08T00:00:00.000",
      timeZone: "UTC",
    });
    expect(event.end).toEqual({
      dateTime: "2026-03-09T00:00:00.000",
      timeZone: "UTC",
    });
  });

  it("states named-zone timed events as their UTC instant", () => {
    const event = serializeOutlookEvent({
      calendarId: "calendar-id",
      calendarName: "Calendar",
      calendarUrl: null,
      endTime: new Date("2026-07-17T16:00:00.000Z"),
      id: "event-id",
      sourceEventUid: "source-uid",
      startTime: new Date("2026-07-17T15:00:00.000Z"),
      startTimeZone: "America/Edmonton",
      summary: "Local meeting",
    });

    expect(event.start).toEqual({
      dateTime: "2026-07-17T15:00:00.000",
      timeZone: "UTC",
    });
    expect(event.end).toEqual({
      dateTime: "2026-07-17T16:00:00.000",
      timeZone: "UTC",
    });
  });

  it("sets sensitivity to private when isPrivate is true", () => {
    const event = serializeOutlookEvent({
      calendarId: "calendar-id",
      calendarName: "Calendar",
      calendarUrl: null,
      endTime: new Date("2026-03-09T17:00:00.000Z"),
      id: "event-id",
      isPrivate: true,
      sourceEventUid: "source-uid",
      startTime: new Date("2026-03-09T16:00:00.000Z"),
      startTimeZone: "UTC",
      summary: "Doctor appointment",
    });

    expect(event.sensitivity).toBe("private");
  });

  it("omits sensitivity when isPrivate is not set", () => {
    const event = serializeOutlookEvent({
      calendarId: "calendar-id",
      calendarName: "Calendar",
      calendarUrl: null,
      endTime: new Date("2026-03-09T17:00:00.000Z"),
      id: "event-id",
      sourceEventUid: "source-uid",
      startTime: new Date("2026-03-09T16:00:00.000Z"),
      startTimeZone: "UTC",
      summary: "Doctor appointment",
    });

    expect(event.sensitivity).toBeUndefined();
  });
});

describe("serializeOutlookEvent for every timed startTimeZone ingest stores", () => {
  it.each(STORED_ZONE_LABELS)("writes the %s instant as UTC wall time", (label) => {
    const serialized = serializeOutlookEvent(buildTimedEvent(label));

    expect(serialized.start).toEqual(toUtcGraphValue(UTC_START));
    expect(serialized.end).toEqual(toUtcGraphValue(UTC_END));
  });

  it("writes an instant with no stored zone as UTC wall time", () => {
    const serialized = serializeOutlookEvent(buildTimedEvent());

    expect(serialized.start).toEqual(toUtcGraphValue(UTC_START));
    expect(serialized.end).toEqual(toUtcGraphValue(UTC_END));
  });

  it.each(STORED_ZONE_LABELS)("never throws and round-trips the %s instant", (label) => {
    expect(() => serializeOutlookEvent(buildTimedEvent(label))).not.toThrow();
    const serialized = serializeOutlookEvent(buildTimedEvent(label));

    expect(parseEventTime(serialized.start)?.toISOString()).toBe(UTC_START.toISOString());
    expect(parseEventTime(serialized.end)?.toISOString()).toBe(UTC_END.toISOString());
  });

  it("writes timed copies on either side of a fall-back fold as UTC", () => {
    const first = new Date("2026-11-01T05:30:00.000Z");
    const second = new Date("2026-11-01T06:30:00.000Z");
    const serialized = serializeOutlookEvent({
      ...buildTimedEvent("America/New_York"),
      endTime: second,
      startTime: first,
    });

    expect(serialized.start).toEqual(toUtcGraphValue(first));
    expect(serialized.end).toEqual(toUtcGraphValue(second));
  });
});

const ingestCalendarConfig = {
  calendarId: "calendar-1",
  database: {} as never,
  plan: {
    futureRange: "2_years" as const,
    historicRange: "1_week" as const,
    window: {
      timeMax: new Date("2027-06-01T00:00:00.000Z"),
      timeMin: new Date("2026-06-01T00:00:00.000Z"),
    },
  },
  url: "https://example.com/calendar.ics",
};

const MOUNTAIN_OBSERVANCES = [
  "BEGIN:STANDARD",
  "DTSTART:16011104T020000",
  "RRULE:FREQ=YEARLY;BYDAY=1SU;BYMONTH=11",
  "TZOFFSETFROM:-0600",
  "TZOFFSETTO:-0700",
  "END:STANDARD",
  "BEGIN:DAYLIGHT",
  "DTSTART:16010311T020000",
  "RRULE:FREQ=YEARLY;BYDAY=2SU;BYMONTH=3",
  "TZOFFSETFROM:-0700",
  "TZOFFSETTO:-0600",
  "END:DAYLIGHT",
];

const FIXED_PLUS_EIGHT_OBSERVANCES = [
  "BEGIN:STANDARD",
  "DTSTART:16010101T000000",
  "TZOFFSETFROM:+0800",
  "TZOFFSETTO:+0800",
  "END:STANDARD",
];

const oneOffFeeds = [
  { label: "Customized Time Zone", observances: MOUNTAIN_OBSERVANCES, uid: "custom-label-one-off" },
  { label: "(UTC-07:00) Mountain Time (US & Canada)", observances: MOUNTAIN_OBSERVANCES, uid: "windows-display-one-off" },
  { label: "(UTC+08:00) Kuala Lumpur, Singapore", observances: FIXED_PLUS_EIGHT_OBSERVANCES, uid: "fixed-display-one-off" },
  { label: "/mozilla.org/20050126_1/America/Denver", observances: MOUNTAIN_OBSERVANCES, uid: "tzurl-one-off" },
];

const buildOneOffFeed = (label: string, observances: readonly string[], uid: string): string => [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//test//test//EN",
  "BEGIN:VTIMEZONE",
  `TZID:${label}`,
  ...observances,
  "END:VTIMEZONE",
  "BEGIN:VEVENT",
  `UID:${uid}`,
  "DTSTAMP:20261101T000000Z",
  `DTSTART;TZID="${label}":20261201T090000`,
  `DTEND;TZID="${label}":20261201T100000`,
  "SUMMARY:Planning",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const ingestFeed = async (ical: string) => {
  const { createIcsSourceFetcher } = await import("../../../../src/ics/utils/fetch-adapter");
  mockPullRemoteCalendar.mockResolvedValueOnce({ ical });
  mockPrepareCalendarSnapshot.mockResolvedValueOnce({ changed: false });
  return createIcsSourceFetcher(ingestCalendarConfig).fetchEvents();
};

const toMaterializedEvent = (event: SourceEvent): MaterializedSyncableEvent => ({
  calendarId: "calendar-1",
  calendarName: "Source",
  calendarUrl: null,
  endTime: event.endTime,
  id: "event-state-1",
  isAllDay: event.isAllDay,
  sourceEventUid: event.uid,
  startTime: event.startTime,
  ...(event.startTimeZone && { startTimeZone: event.startTimeZone }),
  summary: event.title ?? "",
});

describe("serializeOutlookEvent for one-off events as the ICS ingest stores them", () => {
  it.each(oneOffFeeds)("writes the ingested $label one-off at its source instant", async ({ label, observances, uid }) => {
    const result = await ingestFeed(buildOneOffFeed(label, observances, uid));
    const ingested = result.events.find((event) => event.uid === uid);

    expect(result.unsupportedEventUids ?? []).not.toContain(uid);
    expect(ingested).toBeDefined();
    if (!ingested) {
      return;
    }

    const materialized = toMaterializedEvent(ingested);
    expect(() => serializeOutlookEvent(materialized)).not.toThrow();
    const serialized = serializeOutlookEvent(materialized);

    expect(serialized.start).toEqual(toUtcGraphValue(ingested.startTime));
    expect(serialized.end).toEqual(toUtcGraphValue(ingested.endTime));
    expect(parseEventTime(serialized.start)?.toISOString()).toBe(ingested.startTime.toISOString());
  });
});

describe("parseEventTime for a timed Outlook value without a timeZone", () => {
  it("reads a Z-suffixed value as UTC", () => {
    expect(parseEventTime({ dateTime: "2026-12-01T09:00:00Z" })?.toISOString())
      .toBe("2026-12-01T09:00:00.000Z");
  });

  it("reads an explicit offset", () => {
    expect(parseEventTime({ dateTime: "2026-12-01T09:00:00+02:00" })?.toISOString())
      .toBe("2026-12-01T07:00:00.000Z");
  });
});
