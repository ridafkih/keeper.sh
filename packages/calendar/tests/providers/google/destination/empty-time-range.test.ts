import { describe, expect, it } from "vitest";
import type { MaterializedSyncableEvent } from "../../../../src/core/types";
import { serializeGoogleEvent } from "../../../../src/providers/google/destination/serialize-event";

const baseEvent = (overrides: Partial<MaterializedSyncableEvent>): MaterializedSyncableEvent =>
  ({
    availability: "busy",
    calendarId: "calendar-id",
    calendarName: "Calendar",
    calendarUrl: null,
    endTime: new Date("2026-03-08T00:00:00.000Z"),
    id: "event-id",
    location: null,
    sourceEventUid: "source-uid",
    startTime: new Date("2026-03-08T00:00:00.000Z"),
    summary: "Event",
    ...overrides,
  }) as MaterializedSyncableEvent;

describe("serializeGoogleEvent rejects ranges Google cannot accept", () => {
  it("does not emit an all-day event whose end date equals its start date", () => {
    const event = serializeGoogleEvent(
      baseEvent({
        endTime: new Date("2026-03-08T00:00:00.000Z"),
        isAllDay: true,
        startTime: new Date("2026-03-08T00:00:00.000Z"),
      }),
      "destination-uid",
    );
    expect(event?.start?.date).not.toBe(event?.end?.date);
  });

  it("does not emit a timed event whose end instant equals its start instant", () => {
    const event = serializeGoogleEvent(
      baseEvent({
        endTime: new Date("2026-03-08T09:00:00.000Z"),
        startTime: new Date("2026-03-08T09:00:00.000Z"),
      }),
      "destination-uid",
    );
    expect(event?.start?.dateTime).not.toBe(event?.end?.dateTime);
  });
});

describe("serializeGoogleEvent still mirrors the event", () => {
  it("mirrors a zero-duration event as a point in time at its start", () => {
    const event = serializeGoogleEvent(
      baseEvent({
        endTime: new Date("2026-03-08T09:00:00.000Z"),
        startTime: new Date("2026-03-08T09:00:00.000Z"),
      }),
      "destination-uid",
    );
    expect(event?.start?.dateTime).toBe("2026-03-08T09:00:00.000Z");
    expect(event?.end?.dateTime).toBe("2026-03-08T09:01:00.000Z");
  });

  it("mirrors an event whose end precedes its start at its start", () => {
    const event = serializeGoogleEvent(
      baseEvent({
        endTime: new Date("2026-03-08T08:00:00.000Z"),
        startTime: new Date("2026-03-08T09:00:00.000Z"),
      }),
      "destination-uid",
    );
    expect(event?.start?.dateTime).toBe("2026-03-08T09:00:00.000Z");
    expect(event?.end?.dateTime).toBe("2026-03-08T09:01:00.000Z");
  });

  it("mirrors a same-date all-day event as the single day it names", () => {
    const event = serializeGoogleEvent(
      baseEvent({
        endTime: new Date("2026-03-08T00:00:00.000Z"),
        isAllDay: true,
        startTime: new Date("2026-03-08T00:00:00.000Z"),
      }),
      "destination-uid",
    );
    expect(event?.start?.date).toBe("2026-03-08");
    expect(event?.end?.date).toBe("2026-03-09");
  });

  it("leaves a range that already ends after it starts untouched", () => {
    const event = serializeGoogleEvent(
      baseEvent({
        endTime: new Date("2026-03-08T10:30:00.000Z"),
        startTime: new Date("2026-03-08T09:00:00.000Z"),
      }),
      "destination-uid",
    );
    expect(event?.start?.dateTime).toBe("2026-03-08T09:00:00.000Z");
    expect(event?.end?.dateTime).toBe("2026-03-08T10:30:00.000Z");
  });
});
