import { describe, expect, it } from "bun:test";
import type { SourceEvent } from "../types";
import {
  buildSourceEventsToAdd,
  buildSourceEventStateIdsToRemove,
  type ExistingSourceEventState,
} from "./event-diff";

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

  it("removes all matching UIDs during delta cancellation", () => {
    const existingEvents = [
      createExistingEvent({
        id: "instance-1",
        sourceEventUid: "cancelled-uid",
      }),
      createExistingEvent({
        id: "instance-2",
        sourceEventUid: "cancelled-uid",
      }),
      createExistingEvent({
        id: "instance-3",
        sourceEventUid: "other-uid",
      }),
    ];

    const idsToRemove = buildSourceEventStateIdsToRemove(existingEvents, [], {
      cancelledEventUids: ["cancelled-uid"],
      isDeltaSync: true,
    });

    expect(idsToRemove).toEqual(["instance-1", "instance-2"]);
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
    expect(idsToRemove).toEqual(["existing-focus"]);
  });

  it("backfills missing source metadata during full sync", () => {
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
    expect(idsToRemove).toEqual(["existing-default-null"]);
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
});
