import { describe, expect, it } from "vitest";
import { serializeOutlookEvent } from "../../../../src/providers/outlook/destination/serialize-event";

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

  it("preserves all-day dates when the source carries a named timezone", () => {
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
      timeZone: "America/Edmonton",
    });
    expect(event.end).toEqual({
      dateTime: "2026-03-09T00:00:00.000",
      timeZone: "America/Edmonton",
    });
  });

  it("pairs named timezones with local wall times instead of UTC timestamps", () => {
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
      dateTime: "2026-07-17T09:00:00.000",
      timeZone: "America/Edmonton",
    });
    expect(event.end).toEqual({
      dateTime: "2026-07-17T10:00:00.000",
      timeZone: "America/Edmonton",
    });
  });
});
