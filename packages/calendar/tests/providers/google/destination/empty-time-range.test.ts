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
    expect(event).toBeNull();
  });

  it("does not emit a timed event whose end instant precedes its start instant", () => {
    const event = serializeGoogleEvent(
      baseEvent({
        endTime: new Date("2026-03-08T08:00:00.000Z"),
        startTime: new Date("2026-03-08T09:00:00.000Z"),
      }),
      "destination-uid",
    );
    expect(event).toBeNull();
  });

  it("emits an all-day event that spans less than a day as a single full day", () => {
    const event = serializeGoogleEvent(
      baseEvent({
        endTime: new Date("2026-03-08T11:00:00.000Z"),
        isAllDay: true,
        startTime: new Date("2026-03-08T00:00:00.000Z"),
      }),
      "destination-uid",
    );
    expect(event?.start?.date).toBe("2026-03-08");
    expect(event?.end?.date).toBe("2026-03-09");
  });
});
