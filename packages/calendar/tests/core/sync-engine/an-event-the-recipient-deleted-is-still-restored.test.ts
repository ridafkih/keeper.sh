import { describe, expect, it } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import { computeSyncOperations } from "../../../src/core/sync/operations";
import { createSyncEventContentHash } from "../../../src/core/events/content-hash";
import type { MaterializedSyncableEvent, PushResult, RemoteEvent } from "../../../src/core/types";
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

const createDestination = (missingDeleteAnswer: () => PushResult) => {
  const records = new Map<string, DestinationRecord>();
  const deleteTargets: string[] = [];
  const pushedEvents: MaterializedSyncableEvent[] = [];
  let created = 0;

  const provider: CalendarSyncProvider = {
    deleteEvents: (eventIds) => {
      deleteTargets.push(...eventIds);
      return Promise.resolve(eventIds.map((eventId) => {
        if (!records.has(eventId)) {
          return missingDeleteAnswer();
        }
        records.delete(eventId);
        return { success: true };
      }));
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
    records,
    snapshot: (): DestinationRecord[] => [...records.values()],
  };
};

const restoreAfterRecipientDeletion = async (missingDeleteAnswer: () => PushResult) => {
  const event = makeEvent("Team lunch");
  const mapping = makeMapping(createSyncEventContentHash(event));
  const destination = createDestination(missingDeleteAnswer);
  destination.records.set(REMOTE_DELETE_ID, {
    deleteId: REMOTE_DELETE_ID,
    summary: "Team lunch",
    uid: REMOTE_UID,
  });
  destination.records.delete(REMOTE_DELETE_ID);

  const listing = await destination.provider.listRemoteEvents(TEST_RECONCILIATION_SCOPE.authoritativeWindow);
  expect(listing).toEqual([]);

  const { operations } = computeSyncOperations(
    [event],
    [mapping],
    listing,
    TEST_RECONCILIATION_SCOPE,
  );

  const outcome = await executeRemoteOperations(
    operations,
    [mapping],
    DESTINATION_CALENDAR_ID,
    destination.provider,
  );

  return { destination, outcome };
};

describe("an event the recipient deleted is still restored", () => {
  it("recreates the mirror when the destination answers the pre-delete with success", async () => {
    const { destination, outcome } = await restoreAfterRecipientDeletion(() => ({ success: true }));

    expect(destination.pushedEvents.map((pushed) => pushed.id)).toEqual(["ev-1"]);
    const snapshot = destination.snapshot();
    expect(snapshot).toHaveLength(1);
    const mappedDeleteIds = [
      ...outcome.changes.inserts.map((insert) => insert.deleteIdentifier),
      ...(outcome.changes.updates ?? []).map((update) => update.deleteIdentifier),
    ];
    expect(mappedDeleteIds).toEqual(snapshot.map((record) => record.deleteId));
    expect(outcome.result.added).toBe(1);
    expect(outcome.result.removeFailed).toBe(0);
    expect(outcome.errors).toEqual([]);
  });

  it("recreates the mirror when the destination answers the pre-delete 404", async () => {
    const { destination, outcome } = await restoreAfterRecipientDeletion(() => ({
      error: "not found",
      errorType: "not_found",
      statusCode: 404,
      success: false,
    }));

    expect(destination.pushedEvents.map((pushed) => pushed.id)).toEqual(["ev-1"]);
    expect(destination.snapshot()).toHaveLength(1);
    expect(outcome.result.added).toBe(1);
    expect(outcome.result.removeFailed).toBe(0);
    expect(outcome.errors).toEqual([]);
  });

  it("recreates the mirror when the pre-delete reports not found without an http status", async () => {
    const { destination, outcome } = await restoreAfterRecipientDeletion(() => ({
      error: "DELETE https://caldav.example.com/cal/AAMkAGRemoteOne.ics failed: 404 Not Found",
      errorType: "Error",
      success: false,
    }));

    expect(destination.pushedEvents.map((pushed) => pushed.id)).toEqual(["ev-1"]);
    const snapshot = destination.snapshot();
    expect(snapshot).toHaveLength(1);
    const mappedDeleteIds = [
      ...outcome.changes.inserts.map((insert) => insert.deleteIdentifier),
      ...(outcome.changes.updates ?? []).map((update) => update.deleteIdentifier),
    ];
    expect(mappedDeleteIds).toEqual(snapshot.map((record) => record.deleteId));
    expect(outcome.result.added).toBe(1);
    expect(outcome.result.removeFailed).toBe(0);
    expect(outcome.errors).toEqual([]);
  });
});
