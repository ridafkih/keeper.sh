import { describe, expect, it } from "bun:test";
import { eventToICalString, parseICalToRemoteEvent } from "../../../../src/providers/caldav/shared/ics";

describe("eventToICalString", () => {
  it("serializes all-day free events as transparent DATE events", () => {
    const icsString = eventToICalString(
      {
        availability: "free",
        calendarId: "calendar-id",
        calendarName: "Calendar",
        calendarUrl: null,
        endTime: new Date("2026-03-09T00:00:00.000Z"),
        id: "event-id",
        sourceEventUid: "source-uid",
        startTime: new Date("2026-03-08T00:00:00.000Z"),
        summary: "WFH",
      },
      "destination-uid",
    );

    expect(icsString).toContain("DTSTART;VALUE=DATE:20260308");
    expect(icsString).toContain("DTEND;VALUE=DATE:20260309");
    expect(icsString).toContain("TRANSP:TRANSPARENT");

    const parsedEvent = parseICalToRemoteEvent(icsString);

    expect(parsedEvent?.availability).toBe("free");
    expect(parsedEvent?.startTime.toISOString()).toBe("2026-03-08T00:00:00.000Z");
    expect(parsedEvent?.endTime.toISOString()).toBe("2026-03-09T00:00:00.000Z");
  });
});
