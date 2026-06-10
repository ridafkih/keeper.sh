import { describe, expect, it } from "vitest";
import { diffEvents } from "../../../src/ics/utils/diff-events";
import type { EventTimeSlot, StoredEventTimeSlot } from "../../../src/ics/utils/types";

const createBaseEvent = (): EventTimeSlot => ({
  endTime: new Date("2026-03-08T14:30:00.000Z"),
  startTime: new Date("2026-03-08T14:00:00.000Z"),
  startTimeZone: "America/Toronto",
  uid: "event-uid-1",
});

const createStoredEvent = (event: EventTimeSlot): StoredEventTimeSlot => ({
  ...event,
  id: "stored-event-id-1",
});

describe("diffEvents", () => {
  it("does not diff equivalent recurrence payloads with different key order", () => {
    const remoteEvent: EventTimeSlot = {
      ...createBaseEvent(),
      recurrenceRule: {
        byDay: [{ day: "MO", occurrence: 1 }],
        frequency: "WEEKLY",
        until: { date: new Date("2026-12-31T00:00:00.000Z") },
      },
    };

    const storedEvent = createStoredEvent({
      ...createBaseEvent(),
      recurrenceRule: {
        frequency: "WEEKLY",
        until: { date: "2026-12-31T00:00:00.000Z" },
        byDay: [{ occurrence: 1, day: "MO" }],
      },
    });

    const result = diffEvents([remoteEvent], [storedEvent]);

    expect(result.toAdd).toHaveLength(0);
    expect(result.toRemove).toHaveLength(0);
  });

  it("adds and removes when recurrence payload changes", () => {
    const remoteEvent: EventTimeSlot = {
      ...createBaseEvent(),
      recurrenceRule: {
        frequency: "WEEKLY",
        interval: 2,
      },
    };

    const storedEvent = createStoredEvent({
      ...createBaseEvent(),
      recurrenceRule: {
        frequency: "WEEKLY",
        interval: 1,
      },
    });

    const result = diffEvents([remoteEvent], [storedEvent]);

    expect(result.toAdd).toHaveLength(1);
    expect(result.toRemove).toHaveLength(1);
  });

  it("adds and removes when timezone changes", () => {
    const remoteEvent: EventTimeSlot = {
      ...createBaseEvent(),
      startTimeZone: "America/New_York",
    };

    const storedEvent = createStoredEvent(createBaseEvent());
    const result = diffEvents([remoteEvent], [storedEvent]);

    expect(result.toAdd).toHaveLength(1);
    expect(result.toRemove).toHaveLength(1);
  });

  it("adds and removes when exception dates change", () => {
    const remoteEvent: EventTimeSlot = {
      ...createBaseEvent(),
      exceptionDates: [{ date: new Date("2026-03-15T14:00:00.000Z") }],
    };

    const storedEvent = createStoredEvent({
      ...createBaseEvent(),
      exceptionDates: [{ date: "2026-03-22T14:00:00.000Z" }],
    });

    const result = diffEvents([remoteEvent], [storedEvent]);

    expect(result.toAdd).toHaveLength(1);
    expect(result.toRemove).toHaveLength(1);
  });

  it("adds and removes when availability changes", () => {
    const remoteEvent: EventTimeSlot = {
      ...createBaseEvent(),
      availability: "free",
    };

    const storedEvent = createStoredEvent({
      ...createBaseEvent(),
      availability: "workingElsewhere",
    });

    const result = diffEvents([remoteEvent], [storedEvent]);

    expect(result.toAdd).toHaveLength(1);
    expect(result.toRemove).toHaveLength(1);
  });
});
