import { describe, expect, it } from "vitest";
import type { SourceEvent } from "../../../src/core/types";
import type { IngestionChanges } from "../../../src/core/sync-engine/ingest";
import { parseGoogleEvents } from "../../../src/providers/google/source/utils/fetch-events";
import { parseOutlookEvents } from "../../../src/providers/outlook/source/utils/fetch-events";

const makeSourceEvent = (uid: string, startTime: Date, endTime: Date): SourceEvent => ({
  uid,
  startTime,
  endTime,
  title: `Event ${uid}`,
});

interface ExistingEvent {
  id: string;
  sourceEventId?: string | null;
  sourceEventUid: string | null;
  startTime: Date;
  endTime: Date;
  availability: string | null;
  isAllDay: boolean | null;
  sourceEventType: string | null;
  title: string | null;
  description: string | null;
  location: string | null;
  exceptionDates: string | null;
  recurrenceId: Date | null;
  recurrenceRule: string | null;
  startTimeZone: string | null;
}

interface StatefulIngestion {
  events: ExistingEvent[];
  flushes: { inserts: SourceEvent[]; deletes: string[] }[];
  nextId: number;
}

const serializeOptionalJson = (value: unknown): string | null => {
  if (!value) {
    return null;
  }
  return JSON.stringify(value);
};

const toExistingEvent = (id: string, event: SourceEvent): ExistingEvent => ({
  availability: event.availability ?? null,
  description: event.description ?? null,
  endTime: event.endTime,
  exceptionDates: serializeOptionalJson(event.exceptionDates),
  id,
  isAllDay: event.isAllDay ?? null,
  location: event.location ?? null,
  recurrenceId: event.recurrenceId ?? null,
  recurrenceRule: serializeOptionalJson(event.recurrenceRule),
  sourceEventId: event.sourceEventId ?? null,
  sourceEventType: event.sourceEventType ?? null,
  sourceEventUid: event.uid,
  startTime: event.startTime,
  startTimeZone: event.startTimeZone ?? null,
  title: event.title ?? null,
});

const eventStorageIdentity = (
  event: Pick<ExistingEvent, "endTime" | "sourceEventUid" | "startTime">,
): string =>
  `${event.sourceEventUid}|${event.startTime.toISOString()}|${event.endTime.toISOString()}`;

const matchesPersistenceIdentity = (
  existingEvent: ExistingEvent,
  incomingEvent: SourceEvent,
  incomingStorageIdentity: string,
): boolean => {
  if (incomingEvent.sourceEventId) {
    return existingEvent.sourceEventId === incomingEvent.sourceEventId;
  }

  if (incomingEvent.recurrenceId) {
    return existingEvent.sourceEventId === null
      && existingEvent.sourceEventUid === incomingEvent.uid
      && existingEvent.recurrenceId?.getTime() === incomingEvent.recurrenceId.getTime();
  }

  return !existingEvent.sourceEventId
    && eventStorageIdentity(existingEvent) === incomingStorageIdentity;
};

const createStatefulIngestion = async (initialEvents: SourceEvent[]) => {
  const { ingestSource } = await import("../../../src/core/sync-engine/ingest");
  const state: StatefulIngestion = {
    events: initialEvents.map((event, index) => toExistingEvent(`state-${index + 1}`, event)),
    flushes: [],
    nextId: initialEvents.length + 1,
  };

  const ingestDelta = (
    events: SourceEvent[],
    cancelledEventIds: string[] = [],
    changedEventIds: string[] = events.flatMap((event) => event.sourceEventId ?? []),
  ) => ingestSource({
      calendarId: "cal-1",
      fetchEvents: () => Promise.resolve({
        cancelledEventIds,
        changedEventIds,
        events,
        isDeltaSync: true,
      }),
      flush: (changes) => {
        state.flushes.push(changes);
        const deletedIds = new Set(changes.deletes);
        state.events = state.events.filter((event) => !deletedIds.has(event.id));

        for (const event of changes.inserts) {
          const storageIdentity = eventStorageIdentity({
            endTime: event.endTime,
            sourceEventUid: event.uid,
            startTime: event.startTime,
          });
          const existingIndex = state.events.findIndex(
            (existingEvent) => matchesPersistenceIdentity(
              existingEvent,
              event,
              storageIdentity,
            ),
          );
          const existingId = state.events[existingIndex]?.id;
          const eventStateId = existingId ?? `state-${state.nextId}`;
          const storedEvent = toExistingEvent(eventStateId, event);

          if (existingIndex === -1) {
            state.events.push(storedEvent);
            state.nextId += 1;
          } else {
            state.events[existingIndex] = storedEvent;
          }
        }

        return Promise.resolve();
      },
      readExistingEvents: () => Promise.resolve(state.events),
    });

  return { ingestDelta, state };
};

describe("ingestSource", () => {
  it.each([
    {
      createEvents: (starts: string[]) => parseGoogleEvents(starts.map((start, index) => ({
        end: { dateTime: new Date(new Date(start).getTime() + 3_600_000).toISOString() },
        iCalUID: "expanded-series@google",
        id: `google-instance-${index + 1}`,
        start: { dateTime: start },
      }))),
      name: "Google expanded instances",
    },
    {
      createEvents: (starts: string[]) => parseOutlookEvents(starts.map((start, index) => ({
        end: { dateTime: new Date(new Date(start).getTime() + 3_600_000).toISOString(), timeZone: "UTC" },
        iCalUId: `outlook-instance-${index + 1}`,
        id: `outlook-instance-${index + 1}`,
        start: { dateTime: start, timeZone: "UTC" },
      }))),
      name: "Outlook expanded instances",
    },
  ])("converges $name after move, cancellation, restore, and replay", async ({ createEvents }) => {
    const originalStarts: [string, string, string] = [
      "2026-05-04T14:00:00.000Z",
      "2026-05-11T14:00:00.000Z",
      "2026-05-18T14:00:00.000Z",
    ];
    const initialEvents = createEvents(originalStarts);
    const { ingestDelta, state } = await createStatefulIngestion(initialEvents);
    const [, movedEvent] = createEvents([
      originalStarts[0],
      "2026-05-11T17:30:00.000Z",
      originalStarts[2],
    ]);
    if (!movedEvent) {
      throw new Error("Expected the moved occurrence");
    }

    await ingestDelta([movedEvent]);
    expect(state.events.map((event) => event.startTime.toISOString()).toSorted()).toEqual([
      "2026-05-04T14:00:00.000Z",
      "2026-05-11T17:30:00.000Z",
      "2026-05-18T14:00:00.000Z",
    ]);

    const cancelledEventId = initialEvents[0]?.sourceEventId;
    if (!cancelledEventId) {
      throw new Error("Expected the cancelled occurrence ID");
    }
    await ingestDelta([], [cancelledEventId], [cancelledEventId]);
    expect(state.events.map((event) => event.sourceEventId).toSorted()).toEqual([
      initialEvents[1]?.sourceEventId,
      initialEvents[2]?.sourceEventId,
    ].toSorted());

    const [restoredEvent] = initialEvents;
    if (!restoredEvent) {
      throw new Error("Expected the restored occurrence");
    }
    await ingestDelta([restoredEvent]);
    const stateAfterRestore = state.events.map((event) => ({
      id: event.sourceEventId,
      start: event.startTime.toISOString(),
    })).toSorted((left, right) => (left.id ?? "").localeCompare(right.id ?? ""));
    expect(stateAfterRestore).toHaveLength(3);

    const replayResult = await ingestDelta([restoredEvent]);
    expect(replayResult).toEqual({ eventsAdded: 0, eventsRemoved: 0, snapshotConfirmed: true });
    expect(state.events.map((event) => ({
      id: event.sourceEventId,
      start: event.startTime.toISOString(),
    })).toSorted((left, right) => (left.id ?? "").localeCompare(right.id ?? ""))).toEqual(
      stateAfterRestore,
    );
  });

  it("accumulates event inserts from new source events and flushes at the end", async () => {
    const { ingestSource } = await import("../../../src/core/sync-engine/ingest");

    const sourceEvent = makeSourceEvent("uid-1", new Date("2026-03-15T09:00:00Z"), new Date("2026-03-15T10:00:00Z"));

    const flushCapture: { inserts: unknown[]; deletes: string[] }[] = [];

    const result = await ingestSource({
      calendarId: "cal-1",
      fetchEvents: () => Promise.resolve({ events: [sourceEvent] }),
      readExistingEvents: () => Promise.resolve([]),
      flush: (changes) => { flushCapture.push(changes); return Promise.resolve(); },
    });

    expect(result.eventsAdded).toBe(1);
    expect(result.eventsRemoved).toBe(0);
    expect(flushCapture).toHaveLength(1);
    expect(flushCapture[0]?.inserts).toHaveLength(1);
  });

  it("accumulates event deletes when source events are removed", async () => {
    const { ingestSource } = await import("../../../src/core/sync-engine/ingest");

    const existingEvent: ExistingEvent = {
      id: "state-1",
      sourceEventUid: "uid-1",
      startTime: new Date("2026-03-15T09:00:00Z"),
      endTime: new Date("2026-03-15T10:00:00Z"),
      availability: null,
      isAllDay: null,
      sourceEventType: null,
      title: null,
      description: null,
      exceptionDates: null,
      location: null,
      recurrenceId: null,
      recurrenceRule: null,
      startTimeZone: null,
    };

    const flushCapture: { inserts: unknown[]; deletes: string[] }[] = [];

    const result = await ingestSource({
      calendarId: "cal-1",
      fetchEvents: () => Promise.resolve({ events: [] }),
      readExistingEvents: () => Promise.resolve([existingEvent]),
      flush: (changes) => { flushCapture.push(changes); return Promise.resolve(); },
    });

    expect(result.eventsAdded).toBe(0);
    expect(result.eventsRemoved).toBe(1);
    expect(flushCapture).toHaveLength(1);
    expect(flushCapture[0]?.deletes).toHaveLength(1);
    expect(flushCapture[0]?.deletes[0]).toBe("state-1");
  });

  it("upserts a moved delta event without deleting its stable provider row", async () => {
    const { ingestSource } = await import("../../../src/core/sync-engine/ingest");
    const existingEvent: ExistingEvent = {
      availability: null,
      description: null,
      endTime: new Date("2026-03-15T10:00:00Z"),
      id: "state-old-time",
      isAllDay: null,
      location: null,
      exceptionDates: null,
      recurrenceId: null,
      recurrenceRule: null,
      sourceEventType: null,
      sourceEventId: "provider-event-moved",
      sourceEventUid: "uid-moved",
      startTime: new Date("2026-03-15T09:00:00Z"),
      startTimeZone: null,
      title: null,
    };
    const movedEvent = {
      ...makeSourceEvent(
        "uid-moved",
        new Date("2026-03-15T11:00:00Z"),
        new Date("2026-03-15T12:00:00Z"),
      ),
      sourceEventId: "provider-event-moved",
    };
    const flushCapture: { inserts: SourceEvent[]; deletes: string[] }[] = [];

    const result = await ingestSource({
      calendarId: "cal-1",
      fetchEvents: () => Promise.resolve({
        changedEventIds: ["provider-event-moved"],
        events: [movedEvent],
        isDeltaSync: true,
      }),
      flush: (changes) => {
        flushCapture.push(changes);
        return Promise.resolve();
      },
      readExistingEvents: () => Promise.resolve([existingEvent]),
    });

    expect(result).toEqual({ eventsAdded: 1, eventsRemoved: 0, snapshotConfirmed: true });
    expect(flushCapture).toHaveLength(1);
    expect(flushCapture[0]?.deletes).toEqual([]);
    expect(flushCapture[0]?.inserts).toEqual([movedEvent]);
  });

  it("upserts a moved recurrence override through the normal conflict path", async () => {
    const { ingestSource } = await import("../../../src/core/sync-engine/ingest");
    const incomingEvent = {
      ...makeSourceEvent(
        "mapped-recurring-uid",
        new Date("2026-03-15T11:00:00Z"),
        new Date("2026-03-15T12:00:00Z"),
      ),
      recurrenceId: new Date("2026-03-15T09:00:00Z"),
      title: "Moved override",
    };
    const existingEvent = { ...toExistingEvent("mapped-state-id", incomingEvent), title: "Old override" };
    const flushes: IngestionChanges[] = [];

    const result = await ingestSource({
      calendarId: "cal-1",
      fetchEvents: () => Promise.resolve({ events: [incomingEvent] }),
      flush: (changes) => {
        flushes.push(changes);
        return Promise.resolve();
      },
      readExistingEvents: () => Promise.resolve([existingEvent]),
    });

    expect(result).toEqual({ eventsAdded: 1, eventsRemoved: 0, snapshotConfirmed: true });
    expect(flushes).toEqual([{
      deletes: [],
      inserts: [incomingEvent],
    }]);
  });

  it("keeps recurring siblings while one provider occurrence changes and moves", async () => {
    const recurringEvents = [
      {
        ...makeSourceEvent(
          "shared-series-uid",
          new Date("2026-03-02T09:00:00Z"),
          new Date("2026-03-02T10:00:00Z"),
        ),
        sourceEventId: "provider-instance-1",
      },
      {
        ...makeSourceEvent(
          "shared-series-uid",
          new Date("2026-03-04T09:00:00Z"),
          new Date("2026-03-04T10:00:00Z"),
        ),
        sourceEventId: "provider-instance-2",
      },
      {
        ...makeSourceEvent(
          "shared-series-uid",
          new Date("2026-03-06T09:00:00Z"),
          new Date("2026-03-06T10:00:00Z"),
        ),
        sourceEventId: "provider-instance-3",
      },
    ];
    const { ingestDelta, state } = await createStatefulIngestion(recurringEvents);

    const unchangedResult = await ingestDelta([recurringEvents[1] as SourceEvent]);
    expect(unchangedResult).toEqual({ eventsAdded: 0, eventsRemoved: 0, snapshotConfirmed: true });
    expect(state.events).toHaveLength(3);

    const changedOccurrence = {
      ...recurringEvents[1] as SourceEvent,
      title: "Changed title",
    };
    const changedResult = await ingestDelta([changedOccurrence]);
    expect(changedResult).toEqual({ eventsAdded: 1, eventsRemoved: 0, snapshotConfirmed: true });
    expect(state.events).toHaveLength(3);
    expect(state.events.find(
      (event) => event.sourceEventId === "provider-instance-2",
    )?.title).toBe("Changed title");

    const movedOccurrence = {
      ...changedOccurrence,
      endTime: new Date("2026-03-04T12:00:00Z"),
      startTime: new Date("2026-03-04T11:00:00Z"),
    };
    const movedResult = await ingestDelta([movedOccurrence]);
    expect(movedResult).toEqual({ eventsAdded: 1, eventsRemoved: 0, snapshotConfirmed: true });
    expect(state.events).toHaveLength(3);
    expect(state.events.find(
      (event) => event.sourceEventId === "provider-instance-2",
    )?.startTime).toEqual(new Date("2026-03-04T11:00:00Z"));

    const replayResult = await ingestDelta([movedOccurrence]);
    expect(replayResult).toEqual({ eventsAdded: 0, eventsRemoved: 0, snapshotConfirmed: true });
    expect(state.events).toHaveLength(3);
  });

  it("keeps both recurring siblings when one moves onto the other's interval", async () => {
    const sharedStart = new Date("2026-03-02T09:00:00Z");
    const sharedEnd = new Date("2026-03-02T10:00:00Z");
    const recurringEvents = [
      {
        ...makeSourceEvent("shared-series-uid", sharedStart, sharedEnd),
        sourceEventId: "provider-instance-1",
      },
      {
        ...makeSourceEvent(
          "shared-series-uid",
          new Date("2026-03-09T09:00:00Z"),
          new Date("2026-03-09T10:00:00Z"),
        ),
        sourceEventId: "provider-instance-2",
      },
    ];
    const { ingestDelta, state } = await createStatefulIngestion(recurringEvents);
    const movedOccurrence = {
      ...recurringEvents[1] as SourceEvent,
      endTime: sharedEnd,
      startTime: sharedStart,
    };

    const result = await ingestDelta([movedOccurrence]);

    expect(result).toEqual({ eventsAdded: 1, eventsRemoved: 0, snapshotConfirmed: true });
    expect(state.events).toHaveLength(2);
    expect(state.events.map((event) => event.sourceEventId).toSorted()).toEqual([
      "provider-instance-1",
      "provider-instance-2",
    ]);
    expect(state.events.every(
      (event) => event.startTime.getTime() === sharedStart.getTime(),
    )).toBe(true);
  });

  it("cancels one recurring provider occurrence without deleting its siblings", async () => {
    const recurringEvents = [
      {
        ...makeSourceEvent(
          "shared-series-uid",
          new Date("2026-03-02T09:00:00Z"),
          new Date("2026-03-02T10:00:00Z"),
        ),
        sourceEventId: "provider-instance-1",
      },
      {
        ...makeSourceEvent(
          "shared-series-uid",
          new Date("2026-03-04T09:00:00Z"),
          new Date("2026-03-04T10:00:00Z"),
        ),
        sourceEventId: "provider-instance-2",
      },
    ];
    const { ingestDelta, state } = await createStatefulIngestion(recurringEvents);

    const result = await ingestDelta([], ["provider-instance-1"]);

    expect(result).toEqual({ eventsAdded: 0, eventsRemoved: 1, snapshotConfirmed: true });
    expect(state.events.map((event) => event.sourceEventId)).toEqual([
      "provider-instance-2",
    ]);
  });

  it("removes the old state without inserting an occurrence filtered out of the sync window", async () => {
    const sourceEvent = {
      ...makeSourceEvent(
        "event-uid",
        new Date("2026-03-02T09:00:00Z"),
        new Date("2026-03-02T10:00:00Z"),
      ),
      sourceEventId: "provider-event-1",
    };
    const { ingestDelta, state } = await createStatefulIngestion([sourceEvent]);

    const result = await ingestDelta([], [], ["provider-event-1"]);

    expect(result).toEqual({ eventsAdded: 0, eventsRemoved: 1, snapshotConfirmed: true });
    expect(state.events).toEqual([]);
  });

  it("applies only the final version when a provider occurrence changes repeatedly in one delta", async () => {
    const sourceEvent = {
      ...makeSourceEvent(
        "event-uid",
        new Date("2026-03-02T09:00:00Z"),
        new Date("2026-03-02T10:00:00Z"),
      ),
      sourceEventId: "provider-event-1",
    };
    const intermediateVersion = {
      ...sourceEvent,
      endTime: new Date("2026-03-02T11:00:00Z"),
      startTime: new Date("2026-03-02T10:00:00Z"),
    };
    const finalVersion = {
      ...sourceEvent,
      endTime: new Date("2026-03-02T12:00:00Z"),
      startTime: new Date("2026-03-02T11:00:00Z"),
    };
    const { ingestDelta, state } = await createStatefulIngestion([sourceEvent]);

    const result = await ingestDelta([intermediateVersion, finalVersion]);

    expect(result).toEqual({ eventsAdded: 1, eventsRemoved: 0, snapshotConfirmed: true });
    expect(state.events).toHaveLength(1);
    expect(state.events[0]?.startTime).toEqual(new Date("2026-03-02T11:00:00Z"));
  });

  it("does not flush when there are no changes", async () => {
    const { ingestSource } = await import("../../../src/core/sync-engine/ingest");

    let flushCalled = false;

    const result = await ingestSource({
      calendarId: "cal-1",
      fetchEvents: () => Promise.resolve({ events: [] }),
      readExistingEvents: () => Promise.resolve([]),
      flush: () => { flushCalled = true; return Promise.resolve(); },
    });

    expect(result.eventsAdded).toBe(0);
    expect(result.eventsRemoved).toBe(0);
    expect(flushCalled).toBe(false);
  });

  it("flushes a changed snapshot even when the event set is already in sync", async () => {
    const { ingestSource } = await import("../../../src/core/sync-engine/ingest");
    const snapshot = { contentHash: "new-hash", ical: "BEGIN:VCALENDAR" };
    const flushedSnapshots: unknown[] = [];

    await ingestSource({
      calendarId: "cal-1",
      fetchEvents: () => Promise.resolve({ events: [], snapshot }),
      readExistingEvents: () => Promise.resolve([]),
      flush: (changes) => {
        flushedSnapshots.push(changes.snapshot);
        return Promise.resolve();
      },
    });

    expect(flushedSnapshots).toEqual([snapshot]);
  });

  it("fetches before opening the persistence transaction", async () => {
    const { ingestSource } = await import("../../../src/core/sync-engine/ingest");
    const order: string[] = [];

    await ingestSource({
      calendarId: "cal-fetch-order",
      fetchEvents: () => {
        order.push("fetch");
        return Promise.resolve({ events: [] });
      },
      withPersistenceTransaction: (work) => {
        order.push("transaction");
        return work({
          flush: () => Promise.resolve(),
          readExistingEvents: () => Promise.resolve([]),
        });
      },
    });

    expect(order).toEqual(["fetch", "transaction"]);
  });

  it("discards a superseded fetch before opening the persistence transaction", async () => {
    const { ingestSource } = await import("../../../src/core/sync-engine/ingest");
    let transactionEntered = false;

    const result = await ingestSource({
      calendarId: "cal-superseded",
      fetchEvents: () => Promise.resolve({
        events: [makeSourceEvent(
          "older-snapshot",
          new Date("2026-03-15T09:00:00Z"),
          new Date("2026-03-15T10:00:00Z"),
        )],
        snapshot: { contentHash: "older-snapshot", ical: "BEGIN:older-snapshot" },
      }),
      isCurrent: () => Promise.resolve(false),
      withPersistenceTransaction: () => {
        transactionEntered = true;
        return Promise.resolve({ eventsAdded: 0, eventsRemoved: 0, snapshotConfirmed: true });
      },
    });

    /*
     * A superseded run read the source but threw the read away, so it confirms nothing
     * about the stored copy that two-way sync weighs a write against.
     */
    expect(result).toEqual({ eventsAdded: 0, eventsRemoved: 0, snapshotConfirmed: false });
    expect(transactionEntered).toBe(false);
  });

  it("opens a transaction for an unchanged fetch but does not read or flush persistence", async () => {
    const { ingestSource } = await import("../../../src/core/sync-engine/ingest");
    let transactionEntered = false;
    let persistenceUsed = false;

    const result = await ingestSource({
      calendarId: "cal-unchanged",
      fetchEvents: () => Promise.resolve({ events: [], unchanged: true }),
      withPersistenceTransaction: (work) => {
        transactionEntered = true;
        return work({
          flush: () => {
            persistenceUsed = true;
            return Promise.resolve();
          },
          readExistingEvents: () => {
            persistenceUsed = true;
            return Promise.resolve([]);
          },
        });
      },
    });

    expect(result).toEqual({ eventsAdded: 0, eventsRemoved: 0, snapshotConfirmed: true });
    expect(transactionEntered).toBe(true);
    expect(persistenceUsed).toBe(false);
  });

  it("includes sync token in flush when provided by fetchEvents", async () => {
    const { ingestSource } = await import("../../../src/core/sync-engine/ingest");

    const sourceEvent = makeSourceEvent("uid-1", new Date("2026-03-15T09:00:00Z"), new Date("2026-03-15T10:00:00Z"));

    const flushCapture: { syncToken?: string | null }[] = [];

    await ingestSource({
      calendarId: "cal-1",
      fetchEvents: () => Promise.resolve({ events: [sourceEvent], nextSyncToken: "token-abc" }),
      readExistingEvents: () => Promise.resolve([]),
      flush: (changes) => { flushCapture.push(changes); return Promise.resolve(); },
    });

    expect(flushCapture[0]?.syncToken).toBe("token-abc");
  });

  it("emits a wide event with ingestion context", async () => {
    const { ingestSource } = await import("../../../src/core/sync-engine/ingest");

    const sourceEvent = makeSourceEvent("uid-1", new Date("2026-03-15T09:00:00Z"), new Date("2026-03-15T10:00:00Z"));
    const emittedEvents: Record<string, unknown>[] = [];

    await ingestSource({
      calendarId: "cal-1",
      fetchEvents: () => Promise.resolve({ events: [sourceEvent] }),
      readExistingEvents: () => Promise.resolve([]),
      flush: () => Promise.resolve(),
      onIngestEvent: (event) => { emittedEvents.push(event); },
    });

    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0]?.["calendar.id"]).toBe("cal-1");
    expect(emittedEvents[0]?.["events.added"]).toBe(1);
    expect(emittedEvents[0]?.["outcome"]).toBe("success");
    expect(typeof emittedEvents[0]?.["duration_ms"]).toBe("number");
  });

  it("reports the events the fetch dropped before the diff on the wide event", async () => {
    const { ingestSource } = await import("../../../src/core/sync-engine/ingest");

    const storedEvent = makeSourceEvent(
      "uid-1",
      new Date("2026-03-15T09:00:00Z"),
      new Date("2026-03-15T10:00:00Z"),
    );
    storedEvent.sourceEventId = "provider-1";
    const emittedEvents: Record<string, unknown>[] = [];

    await ingestSource({
      calendarId: "cal-1",
      fetchEvents: () => Promise.resolve({
        changedEventIds: ["provider-1"],
        discardedEventCounts: { outsideSyncWindow: 2, unrepresentable: 1 },
        events: [],
        isDeltaSync: true,
      }),
      readExistingEvents: () => Promise.resolve([toExistingEvent("state-1", storedEvent)]),
      flush: () => Promise.resolve(),
      onIngestEvent: (event) => { emittedEvents.push(event); },
    });

    expect(emittedEvents[0]?.["source_events.discarded_outside_window"]).toBe(2);
    expect(emittedEvents[0]?.["source_events.discarded_unrepresentable"]).toBe(1);
    expect(emittedEvents[0]?.["events.removed"]).toBe(1);
  });

  it("repairs a matching corrupt stored recurrence row without deleting its stable ID", async () => {
    const { ingestSource } = await import("../../../src/core/sync-engine/ingest");
    const sourceEvent = makeSourceEvent(
      "uid-corrupt",
      new Date("2026-03-15T09:00:00Z"),
      new Date("2026-03-15T10:00:00Z"),
    );
    const corruptStoredEvent = {
      ...toExistingEvent("state-corrupt", sourceEvent),
      recurrenceRule: "not-json",
    };
    const flushes: { inserts: SourceEvent[]; deletes: string[] }[] = [];
    const emittedEvents: Record<string, unknown>[] = [];

    const result = await ingestSource({
      calendarId: "cal-1",
      fetchEvents: () => Promise.resolve({ events: [sourceEvent] }),
      readExistingEvents: () => Promise.resolve([corruptStoredEvent]),
      flush: (changes) => {
        flushes.push(changes);
        return Promise.resolve();
      },
      onIngestEvent: (event) => { emittedEvents.push(event); },
    });

    expect(result).toEqual({ eventsAdded: 1, eventsRemoved: 0, snapshotConfirmed: true });
    expect(flushes).toEqual([{
      deletes: [],
      inserts: [sourceEvent],
    }]);
    expect(emittedEvents[0]?.["stored_events.invalid_count"]).toBe(1);
    expect(emittedEvents[0]?.["stored_events.invalid_ids"]).toBe("state-corrupt");
    expect(emittedEvents[0]?.["stored_events.validation_errors"]).toBe(
      "Failed to JSON.parse recurrenceRule for event state-corrupt",
    );
  });

  it("resets delta sync when a corrupt stored row requires full-sync recovery", async () => {
    const { ingestSource } = await import("../../../src/core/sync-engine/ingest");
    const sourceEvent = makeSourceEvent(
      "uid-corrupt",
      new Date("2026-03-15T09:00:00Z"),
      new Date("2026-03-15T10:00:00Z"),
    );
    const corruptStoredEvent = {
      ...toExistingEvent("state-corrupt", sourceEvent),
      recurrenceRule: "not-json",
    };

    const flushes: { inserts: SourceEvent[]; deletes: string[]; syncToken?: string | null }[] = [];

    const result = await ingestSource({
      calendarId: "cal-1",
      fetchEvents: () => Promise.resolve({ events: [], isDeltaSync: true }),
      readExistingEvents: () => Promise.resolve([corruptStoredEvent]),
      flush: (changes) => {
        flushes.push(changes);
        return Promise.resolve();
      },
    });

    /*
     * The delta was discarded and the token cleared, so nothing was diffed against the
     * stored copy: the next full sync is what confirms it.
     */
    expect(result).toEqual({ eventsAdded: 0, eventsRemoved: 0, snapshotConfirmed: false });
    expect(flushes).toEqual([{ deletes: [], inserts: [], syncToken: null }]);
  });

  it("does not parse corrupt stored rows when the fetched source is unchanged", async () => {
    const { ingestSource } = await import("../../../src/core/sync-engine/ingest");
    const sourceEvent = makeSourceEvent(
      "uid-corrupt",
      new Date("2026-03-15T09:00:00Z"),
      new Date("2026-03-15T10:00:00Z"),
    );
    const corruptStoredEvent = {
      ...toExistingEvent("state-corrupt", sourceEvent),
      recurrenceRule: "not-json",
    };
    let flushed = false;

    const result = await ingestSource({
      calendarId: "cal-1",
      fetchEvents: () => Promise.resolve({ events: [], unchanged: true }),
      readExistingEvents: () => Promise.resolve([corruptStoredEvent]),
      flush: () => {
        flushed = true;
        return Promise.resolve();
      },
    });

    expect(result).toEqual({ eventsAdded: 0, eventsRemoved: 0, snapshotConfirmed: true });
    expect(flushed).toBe(false);
  });

  it("clears sync token and returns empty result when fullSyncRequired is true", async () => {
    const { ingestSource } = await import("../../../src/core/sync-engine/ingest");

    const existingEvent: ExistingEvent = {
      id: "state-1",
      sourceEventUid: "uid-1",
      startTime: new Date("2026-03-15T09:00:00Z"),
      endTime: new Date("2026-03-15T10:00:00Z"),
      availability: null,
      isAllDay: null,
      sourceEventType: null,
      title: null,
      description: null,
      exceptionDates: null,
      location: null,
      recurrenceId: null,
      recurrenceRule: "not-json",
      startTimeZone: null,
    };

    const flushCapture: { inserts: unknown[]; deletes: string[]; syncToken?: string | null }[] = [];

    const result = await ingestSource({
      calendarId: "cal-1",
      fetchEvents: () => Promise.resolve({ events: [], fullSyncRequired: true }),
      readExistingEvents: () => Promise.resolve([existingEvent]),
      flush: (changes) => { flushCapture.push(changes); return Promise.resolve(); },
    });

    expect(result.eventsAdded).toBe(0);
    expect(result.eventsRemoved).toBe(0);
    expect(flushCapture).toHaveLength(1);
    expect(flushCapture[0]?.inserts).toHaveLength(0);
    expect(flushCapture[0]?.deletes).toHaveLength(0);
    expect(flushCapture[0]?.syncToken).toBeNull();
  });

  it("flushes sync token even when delta sync yields no event changes", async () => {
    const { ingestSource } = await import("../../../src/core/sync-engine/ingest");

    const flushCapture: { inserts: unknown[]; deletes: string[]; syncToken?: string | null }[] = [];

    const result = await ingestSource({
      calendarId: "cal-1",
      fetchEvents: () => Promise.resolve({ events: [], isDeltaSync: true, nextSyncToken: "token-new" }),
      readExistingEvents: () => Promise.resolve([]),
      flush: (changes) => { flushCapture.push(changes); return Promise.resolve(); },
    });

    expect(result.eventsAdded).toBe(0);
    expect(result.eventsRemoved).toBe(0);
    expect(flushCapture).toHaveLength(1);
    expect(flushCapture[0]?.inserts).toHaveLength(0);
    expect(flushCapture[0]?.deletes).toHaveLength(0);
    expect(flushCapture[0]?.syncToken).toBe("token-new");
  });

  it("prunes non-recurring source details outside the successful coverage window", async () => {
    const { ingestSource } = await import("../../../src/core/sync-engine/ingest");
    const historical = makeSourceEvent(
      "historical",
      new Date("2025-01-01T09:00:00.000Z"),
      new Date("2025-01-01T10:00:00.000Z"),
    );
    const inWindow = makeSourceEvent(
      "in-window",
      new Date("2026-03-15T09:00:00.000Z"),
      new Date("2026-03-15T10:00:00.000Z"),
    );
    const syncWindow = {
      timeMin: new Date("2026-03-01T00:00:00.000Z"),
      timeMax: new Date("2026-04-01T00:00:00.000Z"),
    };
    let flushed: IngestionChanges | null = null;

    const result = await ingestSource({
      calendarId: "cal-1",
      fetchEvents: () => Promise.resolve({
        coverage: {
          futureRange: "1_month",
          historicRange: "1_month",
          window: syncWindow,
        },
        events: [],
        isDeltaSync: true,
        syncWindow,
      }),
      readExistingEvents: () => Promise.resolve([
        toExistingEvent("historical-state", historical),
        toExistingEvent("in-window-state", inWindow),
      ]),
      flush: (changes) => {
        flushed = changes;
        return Promise.resolve();
      },
    });

    expect(result).toEqual({ eventsAdded: 0, eventsRemoved: 1, snapshotConfirmed: true });
    expect(flushed).toEqual({
      coverage: {
        futureRange: "1_month",
        historicRange: "1_month",
        window: syncWindow,
      },
      deletes: ["historical-state"],
      inserts: [],
    });
  });

  it("keeps stored history a snapshot source still reports outside the sync window", async () => {
    /*
     * ICS is snapshot-style and fetches the whole feed, so a historic event is
     * still present in every fetch. Pruning it for being outside the window would
     * collapse stored history to a rolling window on the first ingest after
     * deploy, silently truncating the dashboard, MCP tools and published feed.
     */
    const { ingestSource } = await import("../../../src/core/sync-engine/ingest");
    const historical = makeSourceEvent(
      "historical",
      new Date("2019-01-01T09:00:00.000Z"),
      new Date("2019-01-01T10:00:00.000Z"),
    );
    const inWindow = makeSourceEvent(
      "in-window",
      new Date("2026-03-15T09:00:00.000Z"),
      new Date("2026-03-15T10:00:00.000Z"),
    );
    const syncWindow = {
      timeMin: new Date("2026-03-01T00:00:00.000Z"),
      timeMax: new Date("2026-04-01T00:00:00.000Z"),
    };
    let flushed: IngestionChanges | null = null;

    const result = await ingestSource({
      calendarId: "cal-1",
      fetchEvents: () => Promise.resolve({
        coverage: {
          futureRange: "1_month",
          historicRange: "1_month",
          window: syncWindow,
        },
        events: [
          { ...historical, isAllDay: false },
          { ...inWindow, isAllDay: false },
        ],
        syncWindow,
      }),
      readExistingEvents: () => Promise.resolve([
        toExistingEvent("historical-state", { ...historical, isAllDay: false }),
        toExistingEvent("in-window-state", { ...inWindow, isAllDay: false }),
      ]),
      flush: (changes) => {
        flushed = changes;
        return Promise.resolve();
      },
    });

    expect(result).toEqual({ eventsAdded: 0, eventsRemoved: 0, snapshotConfirmed: true });
    expect(flushed).toEqual({
      coverage: {
        futureRange: "1_month",
        historicRange: "1_month",
        window: syncWindow,
      },
      deletes: [],
      inserts: [],
    });
  });

  it("still removes stored state a snapshot source stops reporting", async () => {
    const { ingestSource } = await import("../../../src/core/sync-engine/ingest");
    const historical = makeSourceEvent(
      "historical",
      new Date("2019-01-01T09:00:00.000Z"),
      new Date("2019-01-01T10:00:00.000Z"),
    );
    const syncWindow = {
      timeMin: new Date("2026-03-01T00:00:00.000Z"),
      timeMax: new Date("2026-04-01T00:00:00.000Z"),
    };
    let flushed: IngestionChanges | null = null;

    const result = await ingestSource({
      calendarId: "cal-1",
      fetchEvents: () => Promise.resolve({ events: [], syncWindow }),
      readExistingEvents: () => Promise.resolve([
        toExistingEvent("historical-state", historical),
      ]),
      flush: (changes) => {
        flushed = changes;
        return Promise.resolve();
      },
    });

    expect(result).toEqual({ eventsAdded: 0, eventsRemoved: 1, snapshotConfirmed: true });
    expect(flushed).toEqual({ deletes: ["historical-state"], inserts: [] });
  });

  it("does not flush sync token when no changes and no sync token provided", async () => {
    const { ingestSource } = await import("../../../src/core/sync-engine/ingest");

    let flushCalled = false;

    const result = await ingestSource({
      calendarId: "cal-1",
      fetchEvents: () => Promise.resolve({ events: [] }),
      readExistingEvents: () => Promise.resolve([]),
      flush: () => { flushCalled = true; return Promise.resolve(); },
    });

    expect(result.eventsAdded).toBe(0);
    expect(result.eventsRemoved).toBe(0);
    expect(flushCalled).toBe(false);
  });

  it("drops an over-budget recurrence but keeps ingesting the rest of the calendar", async () => {
    const { ingestSource } = await import("../../../src/core/sync-engine/ingest");
    const pathological: SourceEvent = {
      endTime: new Date("2040-01-01T00:00:01.000Z"),
      recurrenceRule: { frequency: "SECONDLY" },
      sourceEventId: "provider-master-id",
      startTime: new Date("2040-01-01T00:00:00.000Z"),
      uid: "pathological-series",
    };
    const healthy: SourceEvent = {
      endTime: new Date("2040-01-01T10:00:00.000Z"),
      sourceEventId: "healthy-id",
      startTime: new Date("2040-01-01T09:00:00.000Z"),
      uid: "healthy-event",
    };
    const emittedEvents: Record<string, unknown>[] = [];
    const flushes: IngestionChanges[] = [];

    const result = await ingestSource({
      calendarId: "cal-1",
      fetchEvents: () => Promise.resolve({
        events: [pathological, healthy],
        nextSyncToken: "token-1",
        syncWindow: {
          timeMax: new Date("2040-01-02T00:00:00.000Z"),
          timeMin: new Date("2040-01-01T00:00:00.000Z"),
        },
      }),
      flush: (changes) => {
        flushes.push(changes);
        return Promise.resolve();
      },
      onIngestEvent: (event) => emittedEvents.push(event),
      readExistingEvents: () => Promise.resolve([]),
    });

    expect(flushes[0]?.inserts.map(({ uid }) => uid)).toEqual(["healthy-event"]);
    expect(result.eventsAdded).toBe(1);
    expect(emittedEvents[0]?.["recurrence.over_budget_count"]).toBe(1);
    expect(emittedEvents[0]?.["recurrence.over_budget_uids"]).toBe("pathological-series");
    expect(emittedEvents[0]?.["outcome"]).not.toBe("error");
  });

  it("withholds unsupported events, counts them, and keeps their stored state", async () => {
    const { ingestSource } = await import("../../../src/core/sync-engine/ingest");
    const unsupported = makeSourceEvent(
      "unsupported-series",
      new Date("2026-03-02T09:00:00.000Z"),
      new Date("2026-03-02T10:00:00.000Z"),
    );
    const healthy = makeSourceEvent(
      "healthy-event",
      new Date("2026-03-03T09:00:00.000Z"),
      new Date("2026-03-03T10:00:00.000Z"),
    );
    const emittedEvents: Record<string, unknown>[] = [];
    const flushes: IngestionChanges[] = [];

    const result = await ingestSource({
      calendarId: "cal-1",
      fetchEvents: () => Promise.resolve({
        events: [unsupported, healthy],
        unsupportedEventUids: ["unsupported-series"],
      }),
      flush: (changes) => {
        flushes.push(changes);
        return Promise.resolve();
      },
      onIngestEvent: (event) => emittedEvents.push(event),
      readExistingEvents: () => Promise.resolve([
        toExistingEvent("unsupported-state", unsupported),
      ]),
    });

    expect(flushes[0]?.inserts.map(({ uid }) => uid)).toEqual(["healthy-event"]);
    expect(flushes[0]?.deletes).toEqual([]);
    expect(result.eventsAdded).toBe(1);
    expect(emittedEvents[0]?.["source_events.unsupported_count"]).toBe(1);
    expect(emittedEvents[0]?.["source_events.unsupported_uids"]).toBe("unsupported-series");
  });

  it("keeps the stored events of an over-budget series instead of deleting them", async () => {
    const { ingestSource } = await import("../../../src/core/sync-engine/ingest");
    const pathological: SourceEvent = {
      endTime: new Date("2040-01-01T00:00:01.000Z"),
      recurrenceRule: { frequency: "SECONDLY" },
      sourceEventId: "pathological-provider-id",
      startTime: new Date("2040-01-01T00:00:00.000Z"),
      uid: "pathological-series",
    };
    const flushes: IngestionChanges[] = [];

    await ingestSource({
      calendarId: "cal-1",
      fetchEvents: () => Promise.resolve({
        events: [pathological],
        syncWindow: {
          timeMax: new Date("2040-01-02T00:00:00.000Z"),
          timeMin: new Date("2040-01-01T00:00:00.000Z"),
        },
      }),
      flush: (changes) => {
        flushes.push(changes);
        return Promise.resolve();
      },
      readExistingEvents: () => Promise.resolve([
        toExistingEvent("stored-pathological-state", pathological),
      ]),
    });

    expect(flushes[0]?.deletes ?? []).not.toContain("stored-pathological-state");
  });

  it("keeps an unparseable stored row belonging to a withheld over-budget series", async () => {
    const { ingestSource } = await import("../../../src/core/sync-engine/ingest");
    const pathological: SourceEvent = {
      endTime: new Date("2040-01-01T00:00:01.000Z"),
      recurrenceRule: { frequency: "SECONDLY" },
      sourceEventId: "pathological-provider-id",
      startTime: new Date("2040-01-01T00:00:00.000Z"),
      uid: "pathological-series",
    };
    const corruptStoredRow = {
      ...toExistingEvent("corrupt-pathological-state", pathological),
      recurrenceRule: "{not-valid-json",
    };
    const flushes: IngestionChanges[] = [];

    await ingestSource({
      calendarId: "cal-1",
      fetchEvents: () => Promise.resolve({
        events: [pathological],
        syncWindow: {
          timeMax: new Date("2040-01-02T00:00:00.000Z"),
          timeMin: new Date("2040-01-01T00:00:00.000Z"),
        },
      }),
      flush: (changes) => {
        flushes.push(changes);
        return Promise.resolve();
      },
      readExistingEvents: () => Promise.resolve([corruptStoredRow]),
    });

    expect(flushes[0]?.deletes ?? []).not.toContain("corrupt-pathological-state");
  });

  it("emits wide event with flushed: false in error path", async () => {
    const { ingestSource } = await import("../../../src/core/sync-engine/ingest");

    const emittedEvents: Record<string, unknown>[] = [];

    try {
      await ingestSource({
        calendarId: "cal-1",
        fetchEvents: () => Promise.reject(new Error("fetch failed")),
        readExistingEvents: () => Promise.resolve([]),
        flush: () => Promise.resolve(),
        onIngestEvent: (event) => { emittedEvents.push(event); },
      });
    } catch {
      // Expected to throw
    }

    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0]?.["outcome"]).toBe("error");
    expect(emittedEvents[0]?.["flushed"]).toBe(false);
    expect(emittedEvents[0]?.["error.message"]).toBe("fetch failed");
  });
});
