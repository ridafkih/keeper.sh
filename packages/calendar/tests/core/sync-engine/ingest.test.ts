import { describe, expect, it } from "vitest";
import type { SourceEvent } from "../../../src/core/types";

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
}

interface StatefulIngestion {
  events: ExistingEvent[];
  flushes: { inserts: SourceEvent[]; deletes: string[] }[];
  nextId: number;
}

const toExistingEvent = (id: string, event: SourceEvent): ExistingEvent => ({
  availability: event.availability ?? null,
  description: event.description ?? null,
  endTime: event.endTime,
  id,
  isAllDay: event.isAllDay ?? null,
  location: event.location ?? null,
  sourceEventId: event.sourceEventId ?? null,
  sourceEventType: event.sourceEventType ?? null,
  sourceEventUid: event.uid,
  startTime: event.startTime,
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
      location: null,
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
      sourceEventType: null,
      sourceEventId: "provider-event-moved",
      sourceEventUid: "uid-moved",
      startTime: new Date("2026-03-15T09:00:00Z"),
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

    expect(result).toEqual({ eventsAdded: 1, eventsRemoved: 0 });
    expect(flushCapture).toHaveLength(1);
    expect(flushCapture[0]?.deletes).toEqual([]);
    expect(flushCapture[0]?.inserts).toEqual([movedEvent]);
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
    expect(unchangedResult).toEqual({ eventsAdded: 0, eventsRemoved: 0 });
    expect(state.events).toHaveLength(3);

    const changedOccurrence = {
      ...recurringEvents[1] as SourceEvent,
      title: "Changed title",
    };
    const changedResult = await ingestDelta([changedOccurrence]);
    expect(changedResult).toEqual({ eventsAdded: 1, eventsRemoved: 0 });
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
    expect(movedResult).toEqual({ eventsAdded: 1, eventsRemoved: 0 });
    expect(state.events).toHaveLength(3);
    expect(state.events.find(
      (event) => event.sourceEventId === "provider-instance-2",
    )?.startTime).toEqual(new Date("2026-03-04T11:00:00Z"));

    const replayResult = await ingestDelta([movedOccurrence]);
    expect(replayResult).toEqual({ eventsAdded: 0, eventsRemoved: 0 });
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

    expect(result).toEqual({ eventsAdded: 1, eventsRemoved: 0 });
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

    expect(result).toEqual({ eventsAdded: 0, eventsRemoved: 1 });
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

    expect(result).toEqual({ eventsAdded: 0, eventsRemoved: 1 });
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

    expect(result).toEqual({ eventsAdded: 1, eventsRemoved: 0 });
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
      location: null,
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
