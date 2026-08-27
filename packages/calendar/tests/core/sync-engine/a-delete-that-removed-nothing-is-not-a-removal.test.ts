import { describe, expect, it } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import { createSyncEventContentHash } from "../../../src/core/events/content-hash";
import { resolveDestinationAttemptVerdict } from "../../../../sync/src/destination-errors";
import type {
  DeleteResult,
  EventPresence,
  EventVerificationTarget,
  MaterializedSyncableEvent,
  PushResult,
  RemoteEvent,
  SyncOperation,
} from "../../../src/core/types";
import type { CalendarSyncProvider, EventUpdate } from "../../../src/core/sync-engine/types";
import type { EventMapping } from "../../../src/core/events/mappings";

const DESTINATION_CALENDAR_ID = "dest-cal-1";
const MAPPING_ID = "map-1";
const LIVE_UID = "AAMkAGLiveOne";
const LIVE_DELETE_ID = "AAMkAGLiveOneCurrentKey";
const STALE_DELETE_ID = "AAMkAGLiveOneLegacyKey";
const START_TIME = new Date("2026-03-15T09:00:00.000Z");
const END_TIME = new Date("2026-03-15T10:00:00.000Z");

const makeEvent = (summary: string): MaterializedSyncableEvent => ({
  calendarId: "cal-1",
  calendarName: "Test Calendar",
  calendarUrl: null,
  endTime: END_TIME,
  id: "ev-1",
  sourceEventUid: "uid-ev-1",
  startTime: START_TIME,
  summary,
});

const makeMapping = (deleteIdentifier: string, syncEventHash: string): EventMapping => ({
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier,
  destinationEventUid: LIVE_UID,
  endTime: END_TIME,
  eventStateId: "ev-1",
  id: MAPPING_ID,
  sourceCalendarId: "cal-1",
  startTime: START_TIME,
  syncEventHash,
  syncEventId: "ev-1",
});

const makeReplacement = (
  mapping: EventMapping,
  event: MaterializedSyncableEvent,
): Extract<SyncOperation, { type: "replace" }> => ({
  deleteId: mapping.deleteIdentifier,
  event,
  staleMappingId: mapping.id,
  type: "replace",
  uid: mapping.destinationEventUid,
});

interface DestinationRecord {
  deleteId: string;
  summary: string;
  uid: string;
}

const createOutlookLikeDestination = (seeded: DestinationRecord[], updateFailure: PushResult) => {
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
          return { success: true };
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
    updateEvents: (updates: EventUpdate[]) => Promise.resolve(updates.map((): PushResult => updateFailure)),
    verifyEventsExist: (targets: EventVerificationTarget[]) => Promise.resolve(targets.map(
      ({ deleteId, uid }): EventPresence => {
        const mapped = records.get(deleteId);
        if (mapped) {
          return { identifier: deleteId, status: "present" };
        }
        const rekeyed = [...records.values()].find((record) => record.uid === uid);
        if (rekeyed) {
          return {
            event: {
              deleteId: rekeyed.deleteId,
              endTime: END_TIME,
              isKeeperEvent: true,
              startTime: START_TIME,
              uid: rekeyed.uid,
            },
            identifier: deleteId,
            status: "present",
          };
        }
        return { identifier: deleteId, status: "absent" };
      },
    )),
  };

  return {
    deleteTargets,
    provider,
    pushedEvents,
    snapshot: (): DestinationRecord[] => [...records.values()],
  };
};

describe("a delete that removed nothing is not a removal", () => {
  it("reports the failure instead of a successful run when nothing was updated, removed or recreated", async () => {
    const event = makeEvent("Team lunch, moved");
    const mapping = makeMapping(STALE_DELETE_ID, createSyncEventContentHash(makeEvent("Team lunch")));
    const destination = createOutlookLikeDestination(
      [{ deleteId: LIVE_DELETE_ID, summary: "Team lunch", uid: LIVE_UID }],
      { error: "not found", errorType: "MicrosoftGraphHttpError", statusCode: 404, success: false },
    );

    const outcome = await executeRemoteOperations(
      [makeReplacement(mapping, event)],
      [mapping],
      DESTINATION_CALENDAR_ID,
      destination.provider,
    );

    expect(destination.deleteTargets).toEqual([]);
    expect(destination.pushedEvents).toEqual([]);
    expect(outcome.result.removed).toBe(0);

    expect(outcome.result.addFailed).toBeGreaterThan(0);
    expect(outcome.errors.length).toBeGreaterThan(0);

    const verdict = resolveDestinationAttemptVerdict(
      {
        added: outcome.result.added,
        addFailed: outcome.result.addFailed,
        updated: outcome.result.updated,
        conflictsResolved: outcome.conflictsResolved,
        removed: outcome.result.removed,
        removeFailed: outcome.result.removeFailed,
      },
      outcome.superseded,
    );

    expect(verdict).not.toBe("succeeded");
  });
});
