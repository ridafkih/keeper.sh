import { describe, expect, it } from "bun:test";
import { buildSnapshotSyncPlan } from "./snapshot-sync-plan";
import type { EventTimeSlot } from "./types";
import type { SnapshotStoredEvent } from "./snapshot-sync-plan";

const createEventTimeSlot = (overrides: Partial<EventTimeSlot>): EventTimeSlot => ({
  endTime: new Date("2026-03-09T15:00:00.000Z"),
  startTime: new Date("2026-03-09T14:00:00.000Z"),
  startTimeZone: "America/Toronto",
  uid: "event-uid-1",
  ...overrides,
});

const createStoredEvent = (overrides: Partial<SnapshotStoredEvent>): SnapshotStoredEvent => ({
  endTime: new Date("2026-03-09T15:00:00.000Z"),
  id: "stored-id-1",
  startTime: new Date("2026-03-09T14:00:00.000Z"),
  startTimeZone: "America/Toronto",
  uid: "event-uid-1",
  ...overrides,
});

const toStoredEvents = (parsedEvents: EventTimeSlot[]): SnapshotStoredEvent[] =>
  parsedEvents.map((event, index) =>
    createStoredEvent({
      endTime: event.endTime,
      id: `${event.uid}-stored-${index}`,
      startTime: event.startTime,
      startTimeZone: event.startTimeZone,
      uid: event.uid,
    }));

const applySnapshotPlan = (
  storedEvents: SnapshotStoredEvent[],
  parsedEvents: EventTimeSlot[],
): SnapshotStoredEvent[] => {
  const plan = buildSnapshotSyncPlan({
    mappedDestinationUids: new Set(),
    parsedEvents,
    storedEvents,
  });

  const removedStoredIds = new Set(plan.toRemove.map((event) => event.id));
  const retainedEvents = storedEvents.filter((event) => !removedStoredIds.has(event.id));
  const addedEvents = plan.toAdd.map((event, index) =>
    createStoredEvent({
      endTime: event.endTime,
      id: `added-${event.uid}-${index}`,
      startTime: event.startTime,
      startTimeZone: event.startTimeZone,
      uid: event.uid,
    }));

  return [...retainedEvents, ...addedEvents];
};

describe("buildSnapshotSyncPlan", () => {
  it("excludes remote events already mapped on destination", () => {
    const parsedEvents = [
      createEventTimeSlot({ uid: "allowed-uid" }),
      createEventTimeSlot({ uid: "mapped-uid" }),
    ];

    const result = buildSnapshotSyncPlan({
      mappedDestinationUids: new Set(["mapped-uid"]),
      parsedEvents,
      storedEvents: [],
    });

    expect(result.toAdd).toHaveLength(1);
    expect(result.toAdd[0]?.uid).toBe("allowed-uid");
  });

  it("always removes legacy stored events without source uid", () => {
    const legacyStoredEvent = createStoredEvent({
      id: "legacy-id",
      uid: null,
    });

    const result = buildSnapshotSyncPlan({
      mappedDestinationUids: new Set(),
      parsedEvents: [],
      storedEvents: [legacyStoredEvent],
    });

    expect(result.toAdd).toHaveLength(0);
    expect(result.toRemove).toHaveLength(1);
    expect(result.toRemove[0]?.id).toBe("legacy-id");
  });

  it("returns add and remove when stored and parsed recurrence differ", () => {
    const parsedEvents = [
      createEventTimeSlot({
        recurrenceRule: { frequency: "WEEKLY", interval: 2 },
        uid: "recurrence-uid",
      }),
    ];

    const storedEvents = [
      createStoredEvent({
        recurrenceRule: { frequency: "WEEKLY", interval: 1 },
        uid: "recurrence-uid",
      }),
    ];

    const result = buildSnapshotSyncPlan({
      mappedDestinationUids: new Set(),
      parsedEvents,
      storedEvents,
    });

    expect(result.toAdd).toHaveLength(1);
    expect(result.toRemove).toHaveLength(1);
  });

  it("returns no changes when parsed and stored events are equivalent", () => {
    const parsedEvent = createEventTimeSlot({
      exceptionDates: [{ date: new Date("2026-03-16T14:00:00.000Z") }],
      recurrenceRule: { frequency: "WEEKLY", interval: 1 },
      uid: "stable-uid",
    });

    const storedEvent = createStoredEvent({
      exceptionDates: [{ date: "2026-03-16T14:00:00.000Z" }],
      recurrenceRule: { interval: 1, frequency: "WEEKLY" },
      uid: "stable-uid",
    });

    const result = buildSnapshotSyncPlan({
      mappedDestinationUids: new Set(),
      parsedEvents: [parsedEvent],
      storedEvents: [storedEvent],
    });

    expect(result.toAdd).toHaveLength(0);
    expect(result.toRemove).toHaveLength(0);
  });

  it("is idempotent when retrying the same snapshot payload", () => {
    const parsedEvents = [
      createEventTimeSlot({
        uid: "idempotent-1",
      }),
      createEventTimeSlot({
        endTime: new Date("2026-03-10T16:30:00.000Z"),
        startTime: new Date("2026-03-10T15:30:00.000Z"),
        uid: "idempotent-2",
      }),
    ];

    const initiallyStored = toStoredEvents(parsedEvents);
    const firstRetryPlan = buildSnapshotSyncPlan({
      mappedDestinationUids: new Set(),
      parsedEvents,
      storedEvents: initiallyStored,
    });
    const secondRetryPlan = buildSnapshotSyncPlan({
      mappedDestinationUids: new Set(),
      parsedEvents,
      storedEvents: initiallyStored,
    });

    expect(firstRetryPlan.toAdd).toHaveLength(0);
    expect(firstRetryPlan.toRemove).toHaveLength(0);
    expect(secondRetryPlan.toAdd).toHaveLength(0);
    expect(secondRetryPlan.toRemove).toHaveLength(0);
  });

  it("converges to a deterministic final state under rapid add-remove-add churn", () => {
    const snapshotInitial = Array.from({ length: 12 }, (_value, index) =>
      createEventTimeSlot({
        uid: `event-${index + 1}`,
      }));

    const snapshotIntermediate = [
      ...snapshotInitial.slice(3),
      ...Array.from({ length: 5 }, (_value, index) =>
        createEventTimeSlot({
          endTime: new Date(`2026-03-10T${String(index + 10).padStart(2, "0")}:00:00.000Z`),
          startTime: new Date(`2026-03-10T${String(index + 9).padStart(2, "0")}:00:00.000Z`),
          uid: `intermediate-${index + 1}`,
        })),
    ];

    const snapshotFinal = [
      ...snapshotIntermediate.slice(12),
      ...Array.from({ length: 5 }, (_value, index) =>
        createEventTimeSlot({
          endTime: new Date(`2026-03-11T${String(index + 10).padStart(2, "0")}:00:00.000Z`),
          startTime: new Date(`2026-03-11T${String(index + 9).padStart(2, "0")}:00:00.000Z`),
          uid: `final-${index + 1}`,
        })),
    ];

    const storedAfterInitial = toStoredEvents(snapshotInitial);
    const storedAfterIntermediate = applySnapshotPlan(storedAfterInitial, snapshotIntermediate);
    const storedAfterFinal = applySnapshotPlan(storedAfterIntermediate, snapshotFinal);

    const finalPlan = buildSnapshotSyncPlan({
      mappedDestinationUids: new Set(),
      parsedEvents: snapshotFinal,
      storedEvents: storedAfterFinal,
    });

    expect(finalPlan.toAdd).toHaveLength(0);
    expect(finalPlan.toRemove).toHaveLength(0);
    expect(storedAfterFinal.map((event) => event.uid).toSorted()).toEqual(
      snapshotFinal.map((event) => event.uid).toSorted(),
    );
  });
});
