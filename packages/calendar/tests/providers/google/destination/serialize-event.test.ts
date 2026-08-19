import { describe, expect, it } from "vitest";
import {
  restoreAllDayOooTimes,
  serializeGoogleEvent,
} from "../../../../src/providers/google/destination/serialize-event";

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
    expect(event?.start).toEqual({ dateTime: "2026-03-08T09:00:00.000Z" });
    expect(event?.end).toEqual({ dateTime: "2026-03-08T17:00:00.000Z" });
  });

  it("converts all-day oof events to timed Google out-of-office in the destination timezone", () => {
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
      { destinationTimeZone: "Europe/Berlin" },
    );

    expect(event).toMatchObject({
      end: { dateTime: "2026-08-31T23:59:59", timeZone: "Europe/Berlin" },
      eventType: "outOfOffice",
      start: { dateTime: "2026-08-22T00:00:00", timeZone: "Europe/Berlin" },
      summary: "Gamescom",
    });
    expect(event?.start).not.toHaveProperty("date");
    expect(event?.end).not.toHaveProperty("date");
    expect(event?.iCalUID).toBeUndefined();
  });

  it("falls back to UTC wall clock for all-day oof when no destination timezone is known", () => {
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
      end: { dateTime: "2026-08-31T23:59:59", timeZone: "UTC" },
      start: { dateTime: "2026-08-22T00:00:00", timeZone: "UTC" },
    });
  });
});

describe("restoreAllDayOooTimes", () => {
  const parsedStart = new Date("2026-08-21T22:00:00.000Z");
  const parsedEnd = new Date("2026-08-31T21:59:59.000Z");

  it("restores exclusive UTC dates from destination-local midnight walls", () => {
    expect(restoreAllDayOooTimes(
      "2026-08-22T00:00:00+02:00",
      "2026-08-31T23:59:59+02:00",
      parsedStart,
      parsedEnd,
      { startTimeZone: "Europe/Berlin", destinationTimeZone: "Europe/Berlin" },
    )).toEqual({
      endTime: new Date("2026-09-01T00:00:00.000Z"),
      isAllDay: true,
      startTime: new Date("2026-08-22T00:00:00.000Z"),
    });
  });

  it("restores exclusive UTC dates from Z-normalized times with a local timezone", () => {
    expect(restoreAllDayOooTimes(
      "2026-08-21T22:00:00.000Z",
      "2026-08-31T21:59:59.000Z",
      parsedStart,
      parsedEnd,
      { startTimeZone: "Europe/Berlin", destinationTimeZone: "Europe/Berlin" },
    )).toEqual({
      endTime: new Date("2026-09-01T00:00:00.000Z"),
      isAllDay: true,
      startTime: new Date("2026-08-22T00:00:00.000Z"),
    });
  });

  it("leaves legacy UTC-Z all-day OOO unrestored on a non-UTC calendar", () => {
    const start = new Date("2026-08-22T00:00:00.000Z");
    const end = new Date("2026-08-31T23:59:59.000Z");
    expect(restoreAllDayOooTimes(
      "2026-08-22T00:00:00.000Z",
      "2026-08-31T23:59:59.000Z",
      start,
      end,
      { destinationTimeZone: "Europe/Berlin" },
    )).toEqual({
      endTime: end,
      isAllDay: true,
      startTime: start,
    });
  });

  it("restores exclusive midnight from legacy UTC-Z when the destination is UTC", () => {
    const start = new Date("2026-08-22T00:00:00.000Z");
    const end = new Date("2026-08-31T23:59:59.000Z");
    expect(restoreAllDayOooTimes(
      "2026-08-22T00:00:00.000Z",
      "2026-08-31T23:59:59.000Z",
      start,
      end,
      { destinationTimeZone: "UTC" },
    )).toEqual({
      endTime: new Date("2026-09-01T00:00:00.000Z"),
      isAllDay: true,
      startTime: start,
    });
  });
});
