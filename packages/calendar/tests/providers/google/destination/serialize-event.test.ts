import { describe, expect, it } from "vitest";
import { serializeGoogleEvent } from "../../../../src/providers/google/destination/serialize-event";

describe("serializeGoogleEvent", () => {
  it("returns null for working-elsewhere events", () => {
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

    expect(event).toBeNull();
  });
});
