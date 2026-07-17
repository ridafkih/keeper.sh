import { describe, expect, it } from "vitest";
import type { SourceEvent } from "../../../src/core/types";
import {
  buildSourceEventsToAdd,
  buildSourceEventStateIdsToRemove,
  type ExistingSourceEventState,
} from "../../../src/core/source/event-diff";
import { buildSourceEventInstanceKey } from "../../../src/core/source/event-instance";

const createExistingEvent = (
  overrides: Partial<ExistingSourceEventState>,
): ExistingSourceEventState => {
  const event = {
    endTime: new Date("2026-03-11T20:00:00.000Z"),
    exceptionDates: null,
    id: "existing-id-1",
    recurrenceId: null,
    recurrenceRule: null,
    sourceEventUid: "event-uid-1",
    sourceEventType: "default",
    startTime: new Date("2026-03-11T19:00:00.000Z"),
    startTimeZone: null,
    ...overrides,
  };
  const { sourceEventInstanceKey: overriddenInstanceKey } = overrides;
  const resolveInstanceKey = (): string => {
    if (overriddenInstanceKey) {
      return overriddenInstanceKey;
    }
    if (!event.sourceEventUid) {
      return `legacy|${event.id}`;
    }
    return buildSourceEventInstanceKey({
      endTime: event.endTime,
      recurrenceId: event.recurrenceId,
      startTime: event.startTime,
      uid: event.sourceEventUid,
    });
  };
  const sourceEventInstanceKey = resolveInstanceKey();
  return { ...event, sourceEventInstanceKey };
};

const createIncomingEvent = (overrides: Partial<SourceEvent>): SourceEvent => ({
  endTime: new Date("2026-03-11T20:00:00.000Z"),
  sourceEventType: "default",
  startTime: new Date("2026-03-11T19:00:00.000Z"),
  uid: "event-uid-1",
  ...overrides,
});

describe("source event diff", () => {
  it("adds recurring instances that share UID but differ by start and end", () => {
    const existingEvents = [
      createExistingEvent({
        endTime: new Date("2026-03-12T00:00:00.000Z"),
        id: "existing-week-two",
        sourceEventUid: "recurring-uid",
        startTime: new Date("2026-03-11T23:00:00.000Z"),
      }),
    ];

    const incomingEvents = [
      createIncomingEvent({
        endTime: new Date("2026-03-05T00:00:00.000Z"),
        startTime: new Date("2026-03-04T23:00:00.000Z"),
        uid: "recurring-uid",
      }),
      createIncomingEvent({
        endTime: new Date("2026-03-12T00:00:00.000Z"),
        startTime: new Date("2026-03-11T23:00:00.000Z"),
        uid: "recurring-uid",
      }),
    ];

    const eventsToAdd = buildSourceEventsToAdd(existingEvents, incomingEvents);

    expect(eventsToAdd).toHaveLength(1);
    expect(eventsToAdd[0]?.startTime.toISOString()).toBe("2026-03-04T23:00:00.000Z");
  });

  it("keeps provider occurrences distinct when their UID and interval are identical", () => {
    const incomingEvents = [
      createIncomingEvent({
        sourceEventId: "provider-instance-1",
        uid: "recurring-uid",
      }),
      createIncomingEvent({
        sourceEventId: "provider-instance-2",
        uid: "recurring-uid",
      }),
    ];

    expect(buildSourceEventsToAdd([], incomingEvents)).toEqual(incomingEvents);
  });

  it("updates a moved provider occurrence without removing its stable row", () => {
    const existingEvents = [
      createExistingEvent({
        id: "instance-1",
        sourceEventId: "provider-instance-1",
        sourceEventUid: "recurring-uid",
      }),
      createExistingEvent({
        endTime: new Date("2026-03-12T22:00:00.000Z"),
        id: "instance-2",
        sourceEventId: "provider-instance-2",
        sourceEventUid: "recurring-uid",
        startTime: new Date("2026-03-12T21:00:00.000Z"),
      }),
    ];
    const movedEvent = createIncomingEvent({
      sourceEventId: "provider-instance-2",
      uid: "recurring-uid",
    });

    expect(buildSourceEventsToAdd(existingEvents, [movedEvent], {
      isDeltaSync: true,
    })).toEqual([movedEvent]);
    expect(buildSourceEventStateIdsToRemove(existingEvents, [movedEvent], {
      changedEventIds: ["provider-instance-2"],
      isDeltaSync: true,
    })).toEqual([]);
  });

  it("removes only missing recurring instances during full sync", () => {
    const existingEvents = [
      createExistingEvent({
        endTime: new Date("2026-03-05T00:00:00.000Z"),
        id: "instance-old",
        sourceEventUid: "recurring-uid",
        startTime: new Date("2026-03-04T23:00:00.000Z"),
      }),
      createExistingEvent({
        endTime: new Date("2026-03-12T00:00:00.000Z"),
        id: "instance-current",
        sourceEventUid: "recurring-uid",
        startTime: new Date("2026-03-11T23:00:00.000Z"),
      }),
    ];

    const incomingEvents = [
      createIncomingEvent({
        endTime: new Date("2026-03-12T00:00:00.000Z"),
        startTime: new Date("2026-03-11T23:00:00.000Z"),
        uid: "recurring-uid",
      }),
    ];

    const idsToRemove = buildSourceEventStateIdsToRemove(existingEvents, incomingEvents);

    expect(idsToRemove).toEqual(["instance-old"]);
  });

  it("removes only the cancelled provider occurrence during delta sync", () => {
    const existingEvents = [
      createExistingEvent({
        id: "instance-1",
        sourceEventId: "provider-instance-1",
        sourceEventUid: "cancelled-uid",
      }),
      createExistingEvent({
        id: "instance-2",
        sourceEventId: "provider-instance-2",
        sourceEventUid: "cancelled-uid",
      }),
      createExistingEvent({
        id: "instance-3",
        sourceEventId: "provider-instance-3",
        sourceEventUid: "other-uid",
      }),
    ];

    const idsToRemove = buildSourceEventStateIdsToRemove(existingEvents, [], {
      cancelledEventIds: ["provider-instance-2"],
      isDeltaSync: true,
    });

    expect(idsToRemove).toEqual(["instance-2"]);
  });

  it("updates stored events when the source event type changes", () => {
    const existingEvents = [
      createExistingEvent({
        id: "existing-focus",
        sourceEventType: "default",
        sourceEventUid: "typed-uid",
      }),
    ];

    const incomingEvents = [
      createIncomingEvent({
        sourceEventType: "focusTime",
        uid: "typed-uid",
      }),
    ];

    const eventsToAdd = buildSourceEventsToAdd(existingEvents, incomingEvents);
    const idsToRemove = buildSourceEventStateIdsToRemove(existingEvents, incomingEvents);

    expect(eventsToAdd).toHaveLength(1);
    expect(idsToRemove).toEqual([]);
  });

  it("backfills missing source metadata during full sync via upsert", () => {
    const existingEvents = [
      createExistingEvent({
        id: "existing-default-null",
        isAllDay: null,
        sourceEventType: null,
        sourceEventUid: "default-uid",
      }),
    ];

    const incomingEvents = [
      createIncomingEvent({
        isAllDay: false,
        sourceEventType: "default",
        uid: "default-uid",
      }),
    ];

    const eventsToAdd = buildSourceEventsToAdd(existingEvents, incomingEvents);
    const idsToRemove = buildSourceEventStateIdsToRemove(existingEvents, incomingEvents);

    expect(eventsToAdd).toHaveLength(1);
    expect(idsToRemove).toEqual([]);
  });

  it("backfills provider event identity during the forced full sync", () => {
    const existingEvents = [
      createExistingEvent({
        sourceEventId: null,
        sourceEventUid: "event-uid-1",
      }),
    ];
    const incomingEvents = [
      createIncomingEvent({
        sourceEventId: "provider-event-1",
        uid: "event-uid-1",
      }),
    ];

    expect(buildSourceEventsToAdd(existingEvents, incomingEvents)).toEqual(incomingEvents);
    expect(buildSourceEventStateIdsToRemove(existingEvents, incomingEvents)).toEqual([
      "existing-id-1",
    ]);
  });

  it("removes provider rows by provider identity during full sync", () => {
    const existingEvents = [
      createExistingEvent({
        id: "stale-provider-row",
        sourceEventId: "provider-event-old",
      }),
    ];
    const incomingEvents = [
      createIncomingEvent({
        sourceEventId: "provider-event-current",
      }),
    ];

    expect(buildSourceEventStateIdsToRemove(existingEvents, incomingEvents)).toEqual([
      "stale-provider-row",
    ]);
  });

  it("does not duplicate missing source metadata during delta sync", () => {
    const existingEvents = [
      createExistingEvent({
        id: "existing-default-null",
        isAllDay: null,
        sourceEventType: null,
        sourceEventUid: "default-uid",
      }),
    ];

    const incomingEvents = [
      createIncomingEvent({
        isAllDay: false,
        sourceEventType: "default",
        uid: "default-uid",
      }),
    ];

    const eventsToAdd = buildSourceEventsToAdd(existingEvents, incomingEvents, {
      isDeltaSync: true,
    });
    const idsToRemove = buildSourceEventStateIdsToRemove(existingEvents, incomingEvents, {
      isDeltaSync: true,
    });

    expect(eventsToAdd).toHaveLength(0);
    expect(idsToRemove).toEqual([]);
  });

  it("re-adds events when the description changes so the upsert updates content", () => {
    const existingEvents = [
      createExistingEvent({
        description: "Original notes",
        id: "existing-desc",
        sourceEventUid: "desc-uid",
      }),
    ];

    const incomingEvents = [
      createIncomingEvent({
        description: "Updated notes",
        uid: "desc-uid",
      }),
    ];

    const eventsToAdd = buildSourceEventsToAdd(existingEvents, incomingEvents);
    const idsToRemove = buildSourceEventStateIdsToRemove(existingEvents, incomingEvents);

    expect(eventsToAdd).toHaveLength(1);
    expect(eventsToAdd[0]?.description).toBe("Updated notes");
    expect(idsToRemove).toEqual([]);
  });

  it("re-adds events when the title or location changes", () => {
    const existingEvents = [
      createExistingEvent({
        id: "existing-content",
        location: "Room A",
        sourceEventUid: "content-uid",
        title: "Sync",
      }),
    ];

    const incomingEvents = [
      createIncomingEvent({
        location: "Room B",
        title: "Sync (rescheduled)",
        uid: "content-uid",
      }),
    ];

    const eventsToAdd = buildSourceEventsToAdd(existingEvents, incomingEvents);

    expect(eventsToAdd).toHaveLength(1);
    expect(eventsToAdd[0]?.title).toBe("Sync (rescheduled)");
    expect(eventsToAdd[0]?.location).toBe("Room B");
  });

  it("treats whitespace-only description differences as identical", () => {
    const existingEvents = [
      createExistingEvent({
        description: "Notes",
        id: "existing-trim",
        sourceEventUid: "trim-uid",
      }),
    ];

    const incomingEvents = [
      createIncomingEvent({
        description: "  Notes  ",
        uid: "trim-uid",
      }),
    ];

    const eventsToAdd = buildSourceEventsToAdd(existingEvents, incomingEvents);

    expect(eventsToAdd).toEqual([]);
  });

  it("re-adds an event when its recurrence rule changes", () => {
    const existingEvents = [createExistingEvent({
      recurrenceRule: { frequency: "WEEKLY", interval: 1 },
    })];
    const incomingEvents = [createIncomingEvent({
      recurrenceRule: { frequency: "DAILY", interval: 1 },
    })];

    expect(buildSourceEventsToAdd(existingEvents, incomingEvents)).toHaveLength(1);
  });

  it("re-adds an event when its exception dates change", () => {
    const existingEvents = [createExistingEvent({
      exceptionDates: [{ date: new Date("2026-03-18T19:00:00.000Z") }],
    })];
    const incomingEvents = [createIncomingEvent({
      exceptionDates: [{ date: new Date("2026-03-25T19:00:00.000Z") }],
    })];

    expect(buildSourceEventsToAdd(existingEvents, incomingEvents)).toHaveLength(1);
  });

  it("re-adds an event when its recurrence ID changes", () => {
    const existingEvents = [createExistingEvent({
      recurrenceId: new Date("2026-03-11T19:00:00.000Z"),
    })];
    const incomingEvents = [createIncomingEvent({
      recurrenceId: new Date("2026-03-18T19:00:00.000Z"),
    })];

    expect(buildSourceEventsToAdd(existingEvents, incomingEvents)).toHaveLength(1);
  });

  it("re-adds an event when its start timezone changes", () => {
    const existingEvents = [createExistingEvent({ startTimeZone: "America/Edmonton" })];
    const incomingEvents = [createIncomingEvent({ startTimeZone: "America/Toronto" })];

    expect(buildSourceEventsToAdd(existingEvents, incomingEvents)).toHaveLength(1);
  });

  it("compares structured recurrence fields independently of object key order", () => {
    const existingEvents = [createExistingEvent({
      recurrenceRule: { byDay: [{ day: "MO" }], frequency: "WEEKLY" },
    })];
    const incomingEvents = [createIncomingEvent({
      recurrenceRule: { frequency: "WEEKLY", byDay: [{ day: "MO" }] },
    })];

    expect(buildSourceEventsToAdd(existingEvents, incomingEvents)).toEqual([]);
  });

  it("preserves overrides with different recurrence IDs after they move to the same slot", () => {
    const incomingEvents = [
      createIncomingEvent({
        recurrenceId: new Date("2026-03-11T19:00:00.000Z"),
        uid: "recurring-uid",
      }),
      createIncomingEvent({
        recurrenceId: new Date("2026-03-18T19:00:00.000Z"),
        uid: "recurring-uid",
      }),
    ];

    expect(buildSourceEventsToAdd([], incomingEvents)).toHaveLength(2);
  });

  it("updates a moved override without removing its stable recurrence instance", () => {
    const existingEvents = [createExistingEvent({
      endTime: new Date("2026-03-11T20:00:00.000Z"),
      recurrenceId: new Date("2026-03-11T19:00:00.000Z"),
      sourceEventInstanceKey: "recurrence|recurring-uid|2026-03-11T19:00:00.000Z",
      sourceEventUid: "recurring-uid",
      startTime: new Date("2026-03-11T19:00:00.000Z"),
    })];
    const incomingEvents = [createIncomingEvent({
      endTime: new Date("2026-03-11T22:00:00.000Z"),
      recurrenceId: new Date("2026-03-11T19:00:00.000Z"),
      startTime: new Date("2026-03-11T21:00:00.000Z"),
      uid: "recurring-uid",
    })];

    expect(buildSourceEventsToAdd(existingEvents, incomingEvents)).toHaveLength(1);
    expect(buildSourceEventStateIdsToRemove(existingEvents, incomingEvents)).toEqual([]);
  });

  it("deduplicates incoming events that share the same storage identity", () => {
    const incomingEvents = [
      createIncomingEvent({
        sourceEventType: "default",
        title: "Old title",
        uid: "dup-uid",
      }),
      createIncomingEvent({
        sourceEventType: "default",
        title: "New title",
        uid: "dup-uid",
      }),
    ];

    const eventsToAdd = buildSourceEventsToAdd([], incomingEvents);

    expect(eventsToAdd).toHaveLength(1);
    expect(eventsToAdd[0]?.title).toBe("New title");
  });
});
