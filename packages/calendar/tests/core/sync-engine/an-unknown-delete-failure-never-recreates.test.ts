import { describe, expect, it } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import { computeSyncOperations } from "../../../src/core/sync/operations";
import { createSyncEventContentHash } from "../../../src/core/events/content-hash";
import type { DeleteResult, MaterializedSyncableEvent, PushResult, RemoteEvent } from "../../../src/core/types";
import type { CalendarSyncProvider, EventUpdate } from "../../../src/core/sync-engine/types";
import type { EventMapping } from "../../../src/core/events/mappings";

const DESTINATION_CALENDAR_ID = "dest-cal-1";
const MAPPING_ID = "map-1";
const REMOTE_UID = "AAMkAGRemoteOne";
const REMOTE_DELETE_ID = "AAMkAGRemoteOne";
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

const makeMapping = (syncEventHash: string): EventMapping => ({
  remoteAvailability: null,
  remoteContentHash: null,
  remoteEndTime: null,
  remoteStartTime: null,
  id: MAPPING_ID,
  eventStateId: "ev-1",
  syncEventId: "ev-1",
  calendarId: DESTINATION_CALENDAR_ID,
  sourceCalendarId: "cal-1",
  destinationEventUid: REMOTE_UID,
  deleteIdentifier: REMOTE_DELETE_ID,
  syncEventHash,
  startTime: START_TIME,
  endTime: END_TIME,
});

interface DestinationRecord {
  deleteId: string;
  summary: string;
  uid: string;
}

/* The thrown-error branch of a real destination provider: no HTTP response was read, so the
   failure carries a human-readable message and no structured statusCode. */
const createTransportThrowingDestination = (seeded: DestinationRecord[], thrown: Error) => {
  const records = new Map<string, DestinationRecord>();
  for (const record of seeded) {
    records.set(record.deleteId, record);
  }
  const deleteTargets: string[] = [];
  const updateTargets: string[] = [];
  const pushedEvents: MaterializedSyncableEvent[] = [];
  let created = 0;

  const provider: CalendarSyncProvider = {
    deleteEvents: (eventIds) => {
      deleteTargets.push(...eventIds);
      return Promise.resolve(eventIds.map((): DeleteResult => ({
        error: thrown.message,
        errorType: thrown.name,
        success: false,
      })));
    },
    listRemoteEvents: () => Promise.resolve([...records.values()].map((record): RemoteEvent => ({
      deleteId: record.deleteId,
      endTime: END_TIME,
      isKeeperEvent: true,
      startTime: START_TIME,
      uid: record.uid,
    }))),
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
      updateTargets.push(update.deleteId);
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
    updateTargets,
  };
};

describe("an unknown delete failure never recreates", () => {
  it("creates nothing when the delete fails with no structured statusCode", async () => {
    const event = makeEvent("Team lunch");
    const mapping = makeMapping(createSyncEventContentHash(event));
    // A gone-looking number inside prose must not be read as the object's fate.
    const thrown = new Error("DELETE request failed: 410 bytes read before the socket closed");
    const destination = createTransportThrowingDestination(
      [{ deleteId: REMOTE_DELETE_ID, summary: "Team lunch", uid: REMOTE_UID }],
      thrown,
    );

    const windowedListing: RemoteEvent[] = [];

    const { operations } = computeSyncOperations(
      [event],
      [mapping],
      windowedListing,
      TEST_RECONCILIATION_SCOPE,
    );

    expect(operations).toHaveLength(1);
    const [replacement] = operations;
    expect(replacement?.type === "replace" && replacement.remoteMissing).toBe(true);

    const outcome = await executeRemoteOperations(
      operations,
      [mapping],
      DESTINATION_CALENDAR_ID,
      destination.provider,
    );

    expect(destination.deleteTargets).toEqual([REMOTE_DELETE_ID]);
    expect(destination.pushedEvents).toEqual([]);
    expect(outcome.result.added).toBe(0);
    expect(outcome.changes.inserts).toEqual([]);
    expect(destination.snapshot()).toEqual([
      { deleteId: REMOTE_DELETE_ID, summary: "Team lunch", uid: REMOTE_UID },
    ]);
  });
});
