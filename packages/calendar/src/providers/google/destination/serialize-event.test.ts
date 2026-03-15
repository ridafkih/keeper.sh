import { describe, expect, it } from "bun:test";
import { serializeGoogleEvent } from "./serialize-event";

describe("serializeGoogleEvent", () => {
  it("serializes all-day working-elsewhere events without blocking the timed grid", () => {
    const event = serializeGoogleEvent(
      {
        availability: "workingElsewhere",
        calendarId: "calendar-id",
        calendarName: "Calendar",
        calendarUrl: null,
        endTime: new Date("2026-03-09T00:00:00.000Z"),
        id: "event-id",
        location: "Home",
        sourceEventUid: "source-uid",
        startTime: new Date("2026-03-08T00:00:00.000Z"),
        summary: "Working elsewhere",
      },
      "destination-uid",
    );

    expect(event).not.toBeNull();
    if (!event) {
      throw new Error("Expected serialized Google event");
    }

    expect(event.start).toEqual({ date: "2026-03-08" });
    expect(event.end).toEqual({ date: "2026-03-09" });
    expect(event.eventType).toBe("workingLocation");
    expect(event.transparency).toBe("transparent");
  });
});
