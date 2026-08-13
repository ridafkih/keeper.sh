import { describe, expect, it } from "vitest";
import type { MaterializedSyncableEvent } from "../../../../src/core/types";
import { normalizeOutlookEvent } from "../../../../src/providers/outlook/destination/normalize-event";

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

describe("normalizeOutlookEvent", () => {
  it("widens a same-date all-day event to the whole day Graph requires", () => {
    const event = normalizeOutlookEvent(baseEvent({
      endTime: new Date("2026-03-08T00:00:00.000Z"),
      isAllDay: true,
      startTime: new Date("2026-03-08T00:00:00.000Z"),
    }));

    expect(event.startTime).toEqual(new Date("2026-03-08T00:00:00.000Z"));
    expect(event.endTime).toEqual(new Date("2026-03-09T00:00:00.000Z"));
  });

  it("leaves a multi-day all-day event untouched", () => {
    const event = normalizeOutlookEvent(baseEvent({
      endTime: new Date("2026-03-11T00:00:00.000Z"),
      isAllDay: true,
      startTime: new Date("2026-03-08T00:00:00.000Z"),
    }));

    expect(event.endTime).toEqual(new Date("2026-03-11T00:00:00.000Z"));
  });

  it("leaves a zero-duration timed event as it is", () => {
    const event = normalizeOutlookEvent(baseEvent({
      endTime: new Date("2026-03-08T09:00:00.000Z"),
      startTime: new Date("2026-03-08T09:00:00.000Z"),
    }));

    expect(event.startTime).toEqual(new Date("2026-03-08T09:00:00.000Z"));
    expect(event.endTime).toEqual(new Date("2026-03-08T09:00:00.000Z"));
  });
});
