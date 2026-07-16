import { describe, expect, it } from "vitest";
import type { SourceEvent } from "../../../src/core/types";
import {
  buildSourceEventsToAdd,
  buildSourceEventStateIdsToRemove,
  type ExistingSourceEventState,
} from "../../../src/core/source/event-diff";

const createExistingEvent = (
  overrides: Partial<ExistingSourceEventState>,
): ExistingSourceEventState => ({
  endTime: new Date("2026-03-11T20:00:00.000Z"),
  id: "existing-id-1",
  sourceEventUid: "event-uid-1",
  sourceEventType: "default",
  startTime: new Date("2026-03-11T19:00:00.000Z"),
  ...overrides,
});

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
    expect(buildSourceEventStateIdsToRemove(existingEvents, incomingEvents)).toEqual([]);
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
