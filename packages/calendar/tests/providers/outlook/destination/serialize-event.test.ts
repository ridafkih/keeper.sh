import { describe, expect, it } from "bun:test";
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
});
