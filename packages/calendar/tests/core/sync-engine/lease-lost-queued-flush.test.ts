import { describe, expect, it } from "vitest";
import { ingestSource } from "../../../src/core/sync-engine/ingest";
import type { IngestionChanges } from "../../../src/core/sync-engine/ingest";
import type { StoredSourceEventState } from "../../../src/core/source/stored-event-state";
import type { SourceEvent } from "../../../src/core/types";

/*
 * Lock currency is probed once before the flush thunk is enqueued and never
 * re-consulted inside the queued transaction, so a parked thunk can outlive its
 * lease. No such interleaving may persist a stale snapshot over a fresher one.
 */

const CALENDAR_ID = "calendar-lease-lost-queued-flush";

const storedIdFor = (event: SourceEvent): string => `${event.uid}::stored`;

const toStored = (event: SourceEvent): StoredSourceEventState => ({
  availability: event.availability ?? null,
  description: event.description ?? null,
  endTime: event.endTime,
  exceptionDates: null,
  id: storedIdFor(event),
  isAllDay: event.isAllDay ?? false,
  location: event.location ?? null,
  recurrenceId: event.recurrenceId ?? null,
  recurrenceRule: null,
  sourceEventId: event.sourceEventId ?? null,
  sourceEventType: event.sourceEventType ?? "default",
  sourceEventUid: event.uid,
  startTime: event.startTime,
  startTimeZone: event.startTimeZone ?? null,
  title: event.title ?? null,
});

const makeEvent = (uid: string, startHour: number): SourceEvent => ({
  availability: "busy",
  endTime: new Date(Date.UTC(2026, 7, 20, startHour + 1)),
  isAllDay: false,
  startTime: new Date(Date.UTC(2026, 7, 20, startHour)),
  title: uid,
  uid,
});

interface Store {
  rows: StoredSourceEventState[];
}

const applyChanges = (store: Store, changes: IngestionChanges): void => {
  const deleted = new Set(changes.deletes);
  store.rows = store.rows.filter((row) => !deleted.has(row.id));
  store.rows = [...store.rows, ...changes.inserts.map(toStored)];
};

const runFreshHolder = (
  store: Store,
  events: SourceEvent[],
): Promise<{ eventsAdded: number; eventsRemoved: number }> =>
  ingestSource({
    calendarId: CALENDAR_ID,
    fetchEvents: () => Promise.resolve({ events }),
    readExistingEvents: () => Promise.resolve([...store.rows]),
    flush: (changes) => {
      applyChanges(store, changes);
      return Promise.resolve();
    },
  });

describe("queued flush after the Redis lease is lost", () => {
  it("a stale thunk whose lease was reclaimed must not commit over the fresher holder's snapshot", async () => {
    const eventX = makeEvent("event-x", 9);
    const eventY = makeEvent("event-y", 13);

    const store: Store = { rows: [toStored(eventX)] };

    let leaseHeld = true;

    const { promise: gate, resolve: releaseGate } = Promise.withResolvers<null>();
    const { promise: enqueued, resolve: markEnqueued } = Promise.withResolvers<null>();

    const cronRun = ingestSource({
      calendarId: CALENDAR_ID,
      fetchEvents: () => Promise.resolve({ events: [eventX] }),
      isCurrent: () => Promise.resolve(leaseHeld),
      withPersistenceTransaction: async (work) => {
        markEnqueued(null);
        await gate;
        return work({
          readExistingEvents: () => Promise.resolve([...store.rows]),
          flush: (changes) => {
            applyChanges(store, changes);
            return Promise.resolve();
          },
        });
      },
    });

    await enqueued;

    // Reclaim by TTL while the thunk waits is a designed event, not a fault.
    leaseHeld = false;

    const freshResult = await runFreshHolder(store, [eventX, eventY]);
    expect(freshResult.eventsAdded).toBe(1);
    expect(store.rows.map((row) => row.sourceEventUid).toSorted())
      .toEqual(["event-x", "event-y"]);

    releaseGate(null);
    await cronRun;

    expect(store.rows.map((row) => row.sourceEventUid).toSorted())
      .toEqual(["event-x", "event-y"]);

    const repeat = await runFreshHolder(store, [eventX, eventY]);
    expect(repeat.eventsAdded).toBe(0);
    expect(repeat.eventsRemoved).toBe(0);
  });
});
