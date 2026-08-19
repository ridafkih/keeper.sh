import { describe, expect, it } from "vitest";
import { ingestSource } from "../../../src/core/sync-engine/ingest";
import type { IngestionChanges } from "../../../src/core/sync-engine/ingest";
import type { StoredSourceEventState } from "../../../src/core/source/stored-event-state";
import type { SourceEvent } from "../../../src/core/types";

/*
 * Lock currency is probed exactly once, BEFORE the flush thunk is enqueued
 * (ingest.ts: `if (isCurrent && !(await isCurrent()))` runs ahead of
 * withPersistenceTransaction). The cron persistence transaction
 * (services/cron/src/jobs/ingest-sources.ts createIngestionPersistenceTransaction)
 * never re-consults isCurrent/isHeld inside the queued transaction — only
 * signal.throwIfAborted(). So a thunk parked in the serial flush pump can
 * outlive its Redis lease (reclaim by TTL is a designed event: "The lock TTL
 * already reclaims the hold"), a second lock-respecting writer (the API's
 * ingestIcsSource, which flushes directly through the pooled database) can
 * commit a FRESHER snapshot, and the stale thunk then commits over it.
 *
 * This test models that interleaving faithfully:
 *  - isCurrent returns true at the pre-enqueue probe (lease still held),
 *  - the lease is lost while the thunk waits in the queue,
 *  - a fresh writer commits upstream state [X, Y],
 *  - the parked stale thunk (fetched [X]) finally runs.
 *
 * Invariant under attack: no interleaving may persist a stale snapshot over a
 * fresher one. A run whose lease was lost before its flush ran must not
 * remove events the fresher holder just committed.
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

/* The API's ingestIcsSource path: holds the lock, flushes directly. */
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

    /* True while the cron run's Redis lease is held; flips on reclaim. */
    let leaseHeld = true;

    const { promise: gate, resolve: releaseGate } = Promise.withResolvers<null>();
    const { promise: enqueued, resolve: markEnqueued } = Promise.withResolvers<null>();

    /*
     * Cron run C fetches while upstream is [X]. Its pre-enqueue isCurrent probe
     * passes (lease still held), then the thunk parks in the serial flush pump
     * behind other calendars' flushes — exactly what reservation.submit does in
     * createIngestionPersistenceTransaction, where the transaction body has no
     * isCurrent/isHeld consultation.
     */
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

    /* The probe has passed and the thunk is queued. */
    await enqueued;

    /*
     * The lease is reclaimed while C's thunk waits (Redis TTL expiry — a
     * designed event per ingest-sources.ts: "The lock TTL already reclaims the
     * hold"). From here on, C is no longer the lock holder.
     */
    leaseHeld = false;

    /* A fresh holder acquires the lock and commits upstream state [X, Y]. */
    const freshResult = await runFreshHolder(store, [eventX, eventY]);
    expect(freshResult.eventsAdded).toBe(1);
    expect(store.rows.map((row) => row.sourceEventUid).toSorted())
      .toEqual(["event-x", "event-y"]);

    /* The pump dequeues C's stale thunk. Its lease is gone; it must not write. */
    releaseGate(null);
    await cronRun;

    /*
     * The fresher snapshot [X, Y] must survive: a writer that lost its lease
     * before flushing may not delete what the current holder committed.
     */
    expect(store.rows.map((row) => row.sourceEventUid).toSorted())
      .toEqual(["event-x", "event-y"]);

    /*
     * Convergence: upstream is still [X, Y], so re-ingesting the same state
     * must be a no-op. If C's stale flush deleted Y, this pass re-adds it —
     * a remove/add pair on the destination with no upstream change.
     */
    const repeat = await runFreshHolder(store, [eventX, eventY]);
    expect(repeat.eventsAdded).toBe(0);
    expect(repeat.eventsRemoved).toBe(0);
  });
});
