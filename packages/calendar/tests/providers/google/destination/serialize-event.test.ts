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

  it("sets visibility to private when isPrivate is true", () => {
    const event = serializeGoogleEvent(
      {
        calendarId: "calendar-id",
        calendarName: "Calendar",
        calendarUrl: null,
        endTime: new Date("2026-03-09T00:00:00.000Z"),
        id: "event-id",
        isPrivate: true,
        sourceEventUid: "source-uid",
        startTime: new Date("2026-03-08T00:00:00.000Z"),
        summary: "Team lunch",
      },
      "destination-uid",
    );

    expect(event?.visibility).toBe("private");
  });

  it("omits visibility when isPrivate is not set", () => {
    const event = serializeGoogleEvent(
      {
        calendarId: "calendar-id",
        calendarName: "Calendar",
        calendarUrl: null,
        endTime: new Date("2026-03-09T00:00:00.000Z"),
        id: "event-id",
        sourceEventUid: "source-uid",
        startTime: new Date("2026-03-08T00:00:00.000Z"),
        summary: "Team lunch",
      },
      "destination-uid",
    );

    expect(event?.visibility).toBeUndefined();
  });
});
