import { describe, expect, it } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import { computeSyncOperations } from "../../../src/core/sync/operations";
import { createSyncEventContentHash } from "../../../src/core/events/content-hash";
import type { DeleteResult, MaterializedSyncableEvent, PushResult, RemoteEvent } from "../../../src/core/types";
import type { CalendarSyncProvider, EventUpdate } from "../../../src/core/sync-engine/types";
import type { EventMapping } from "../../../src/core/events/mappings";

const DESTINATION_CALENDAR_ID = "dest-cal-1";
const MAPPING_ID = "map-1";
const LIVE_UID = "AAMkAGLiveOne";
const LIVE_DELETE_ID = "AAMkAGLiveOneCurrentKey";
const STALE_DELETE_ID = "AAMkAGLiveOneLegacyKey";
const START_TIME = new Date("2026-03-15T09:00:00Z");
const END_TIME = new Date("2026-03-15T10:00:00Z");

const TEST_RECONCILIATION_SCOPE = {
  authoritativeWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
  requestedWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
};

/* The distinction this spec needs: a delete may report success without having removed anything.
   Only removedObject is positive evidence that an object left the destination. */
interface RemovalEvidence extends DeleteResult {
  removedObject?: boolean;
}

const makeEvent = (summary: string): MaterializedSyncableEvent => ({
  id: "ev-1",
  sourceEventUid: "uid-ev-1",
  startTime: START_TIME,
  endTime: END_TIME,
  summary,
  calendarId: "cal-1",
  calendarName: "Test Calendar",
  calendarUrl: null,
});

const makeMapping = (deleteIdentifier: string, syncEventHash: string): EventMapping => ({
  remoteAvailability: null,
  remoteContentHash: null,
  remoteEndTime: null,
  remoteStartTime: null,
  id: MAPPING_ID,
  eventStateId: "ev-1",
  syncEventId: "ev-1",
  calendarId: DESTINATION_CALENDAR_ID,
  sourceCalendarId: "cal-1",
  destinationEventUid: LIVE_UID,
  deleteIdentifier,
  syncEventHash,
  startTime: START_TIME,
  endTime: END_TIME,
});

interface DestinationRecord {
  deleteId: string;
  summary: string;
  uid: string;
}

/* Mirrors packages/calendar/src/providers/outlook/destination/provider.ts:346-355: a DELETE that
   404s is NOT reported as a failure — the real provider pushes { success: true } for it. */
const createOutlookLikeDestination = (seeded: DestinationRecord[]) => {
  const records = new Map<string, DestinationRecord>();
  for (const record of seeded) {
    records.set(record.deleteId, record);
  }
  const deleteTargets: string[] = [];
  const pushedEvents: MaterializedSyncableEvent[] = [];
  let created = 0;

  const provider: CalendarSyncProvider = {
    deleteEvents: (eventIds) => {
      deleteTargets.push(...eventIds);
      return Promise.resolve(eventIds.map((eventId): DeleteResult => {
        if (!records.has(eventId)) {
          const nothingThere: RemovalEvidence = { success: true };
          return nothingThere;
        }
        records.delete(eventId);
        const removed: RemovalEvidence = { removedObject: true, success: true };
        return removed;
      }));
    },
    listRemoteEvents: () => Promise.resolve([...records.values()].map((record): RemoteEvent => ({
      deleteId: record.deleteId,
      endTime: END_TIME,
      isKeeperEvent: true,
      startTime: START_TIME,
      uid: record.uid,
    }))),
    // Outlook's pushEvents is a create-only POST: it can never land on an existing object.
    pushEvents: (events) => {
      pushedEvents.push(...events);
      return Promise.resolve(events.map((event): PushResult => {
        created += 1;
        const record = {
          deleteId: `AAMkAGCreated${created}`,
          summary: event.summary,
          uid: `AAMkAGCreated${created}`,
        };
        records.set(record.deleteId, record);
        return { deleteId: record.deleteId, remoteId: record.uid, success: true };
      }));
    },
    updateEvents: (updates: EventUpdate[]) => Promise.resolve(updates.map((update): PushResult => {
      const existing = records.get(update.deleteId);
      if (!existing) {
        return { error: "not found", errorType: "not_found", statusCode: 404, success: false };
      }
      records.set(update.deleteId, { ...existing, summary: update.event.summary });
      return { deleteId: update.deleteId, remoteId: existing.uid, success: true };
    })),
  };

  return {
    deleteTargets,
    provider,
    pushedEvents,
    snapshot: (): DestinationRecord[] => [...records.values()],
  };
};

const planMissingMirrorReplacement = (event: MaterializedSyncableEvent, mapping: EventMapping) => {
  // The targeted read never enumerates unmapped events, so the mirror only looks absent.
  const windowedListing: RemoteEvent[] = [];
  const { operations } = computeSyncOperations(
    [event],
    [mapping],
    windowedListing,
    TEST_RECONCILIATION_SCOPE,
  );
  expect(operations).toHaveLength(1);
  const [replacement] = operations;
  expect(replacement?.type).toBe("replace");
  expect(replacement?.type === "replace" && replacement.remoteMissing).toBe(true);
  return operations;
};

describe("a delete that removed nothing never creates", () => {
  it("does not create a second copy when the delete only found nothing at a stale identifier", async () => {
    const event = makeEvent("Team lunch");
    const mapping = makeMapping(STALE_DELETE_ID, createSyncEventContentHash(event));
    const destination = createOutlookLikeDestination([
      { deleteId: LIVE_DELETE_ID, summary: "Team lunch", uid: LIVE_UID },
    ]);

    const operations = planMissingMirrorReplacement(event, mapping);

    await executeRemoteOperations(operations, [mapping], DESTINATION_CALENDAR_ID, destination.provider);

    expect(destination.deleteTargets).toEqual([STALE_DELETE_ID]);
    // The delete reported success, but nothing left the destination: the live event is still there.
    expect(destination.pushedEvents).toHaveLength(0);
    expect(destination.snapshot()).toEqual([
      { deleteId: LIVE_DELETE_ID, summary: "Team lunch", uid: LIVE_UID },
    ]);
  });

  it("still restores the mirror when the delete gives positive evidence it removed the object", async () => {
    const event = makeEvent("Team lunch");
    const mapping = makeMapping(LIVE_DELETE_ID, createSyncEventContentHash(event));
    const destination = createOutlookLikeDestination([
      { deleteId: LIVE_DELETE_ID, summary: "Team lunch", uid: LIVE_UID },
    ]);

    const operations = planMissingMirrorReplacement(event, mapping);

    const outcome = await executeRemoteOperations(
      operations,
      [mapping],
      DESTINATION_CALENDAR_ID,
      destination.provider,
    );

    expect(destination.pushedEvents).toHaveLength(1);
    const snapshot = destination.snapshot();
    expect(snapshot).toHaveLength(1);
    expect(outcome.changes.inserts.map((insert) => insert.deleteIdentifier)).toEqual(
      snapshot.map((record) => record.deleteId),
    );
  });
});
