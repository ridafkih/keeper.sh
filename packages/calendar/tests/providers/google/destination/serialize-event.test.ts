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

  it("serializes timed oof events as Google out-of-office", () => {
    const event = serializeGoogleEvent(
      {
        availability: "oof",
        calendarId: "calendar-id",
        calendarName: "Calendar",
        calendarUrl: null,
        endTime: new Date("2026-03-08T17:00:00.000Z"),
        id: "event-id",
        sourceEventUid: "source-uid",
        startTime: new Date("2026-03-08T09:00:00.000Z"),
        summary: "Private block",
      },
      "destination-uid@keeper.sh",
    );

    expect(event).toMatchObject({
      eventType: "outOfOffice",
      extendedProperties: {
        private: { keeperEventUid: "destination-uid@keeper.sh" },
      },
      id: expect.stringMatching(/^[0-9a-f]{64}$/),
      outOfOfficeProperties: {
        autoDeclineMode: "declineAllConflictingInvitations",
      },
      summary: "Private block",
      transparency: "opaque",
    });
    expect(event?.iCalUID).toBeUndefined();
  });

  it("converts all-day oof events to timed Google out-of-office", () => {
    const event = serializeGoogleEvent(
      {
        availability: "oof",
        calendarId: "calendar-id",
        calendarName: "Calendar",
        calendarUrl: null,
        endTime: new Date("2026-09-01T00:00:00.000Z"),
        id: "event-id",
        isAllDay: true,
        sourceEventUid: "source-uid",
        startTime: new Date("2026-08-22T00:00:00.000Z"),
        summary: "Gamescom",
      },
      "destination-uid@keeper.sh",
    );

    expect(event).toMatchObject({
      end: { dateTime: "2026-09-01T00:00:00.000Z" },
      eventType: "outOfOffice",
      start: { dateTime: "2026-08-22T00:00:00.000Z" },
      summary: "Gamescom",
    });
    expect(event?.start).not.toHaveProperty("date");
    expect(event?.end).not.toHaveProperty("date");
    expect(event?.iCalUID).toBeUndefined();
  });
});
