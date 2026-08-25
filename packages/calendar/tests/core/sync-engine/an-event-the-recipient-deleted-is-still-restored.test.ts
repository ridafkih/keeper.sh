import { describe, expect, it } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import { computeSyncOperations } from "../../../src/core/sync/operations";
import { createSyncEventContentHash } from "../../../src/core/events/content-hash";
import type {
  DeleteResult,
  EventPresence,
  EventVerificationTarget,
  MaterializedSyncableEvent,
  PushResult,
  RemoteEvent,
} from "../../../src/core/types";
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

const createDestination = (
  missingDeleteAnswer: () => DeleteResult,
  verifyEventsExist?: CalendarSyncProvider["verifyEventsExist"],
) => {
  const records = new Map<string, DestinationRecord>();
  const deleteTargets: string[] = [];
  const pushedEvents: MaterializedSyncableEvent[] = [];
  let created = 0;

  const provider: CalendarSyncProvider = {
    deleteEvents: (eventIds) => {
      deleteTargets.push(...eventIds);
      return Promise.resolve(eventIds.map((eventId): DeleteResult => {
        if (!records.has(eventId)) {
          return missingDeleteAnswer();
        }
        records.delete(eventId);
        return { removedObject: true, success: true };
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
    ...(verifyEventsExist && { verifyEventsExist }),
  };

  return {
    deleteTargets,
    provider,
    pushedEvents,
    records,
    snapshot: (): DestinationRecord[] => [...records.values()],
  };
};

const reportAbsent = (targets: EventVerificationTarget[]): Promise<EventPresence[]> =>
  Promise.resolve(targets.map(({ deleteId }): EventPresence => ({ identifier: deleteId, status: "absent" })));

/* The recipient really deleted the mirror, so nothing is left for the pre-delete to remove: whatever
   the destination answers that delete, only the verification read establishes the absence. */
const restoreAfterRecipientDeletion = async (missingDeleteAnswer: () => DeleteResult) => {
  const event = makeEvent("Team lunch");
  const mapping = makeMapping(createSyncEventContentHash(event));
  const destination = createDestination(missingDeleteAnswer, reportAbsent);

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
  it("recreates the mirror when a verified absence sits behind a pre-delete answered with success", async () => {
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

  it("recreates the mirror when a verified absence sits behind a pre-delete answered 404", async () => {
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

  it("recreates the mirror when a verified absence sits behind a pre-delete reporting not found without an http status", async () => {
    const { destination, outcome } = await restoreAfterRecipientDeletion(() => ({
      error: "DELETE /calendar/AAMkAGRemoteOne.ics failed: 404 Not Found",
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
