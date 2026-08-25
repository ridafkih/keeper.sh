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

/*
 * Mirrors packages/calendar/src/providers/outlook/destination/provider.ts deleteEvents: a DELETE
 * that 404s is reported as { success: true } with no removedObject, and only a 2xx DELETE carries
 * removal evidence. pushEvents there is a create-only POST, so a wrong create duplicates forever.
 */
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
    verifyEventsExist: (targets: EventVerificationTarget[]) => Promise.resolve(targets.map(({ deleteId }): EventPresence => {
      if (records.has(deleteId)) {
        return { identifier: deleteId, status: "present" };
      }
      return { identifier: deleteId, status: "absent" };
    })),
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

    // The bare 404-mapped success removed nothing, and nothing was recreated in its place.
    expect(destination.deleteTargets).toEqual([STALE_DELETE_ID]);
    expect(destination.pushedEvents).toEqual([]);
    expect(outcome.result.removed).toBe(0);

    // The suppressed half: the cycle achieved nothing, so it must surface as a failure.
    expect(outcome.result.addFailed).toBeGreaterThan(0);
    expect(outcome.errors.length).toBeGreaterThan(0);

    const verdict = resolveDestinationAttemptVerdict(
      {
        added: outcome.result.added,
        addFailed: outcome.result.addFailed,
        conflictsResolved: outcome.conflictsResolved,
        removed: outcome.result.removed,
        removeFailed: outcome.result.removeFailed,
      },
      outcome.superseded,
    );

    // 'succeeded' resets the failure count, so the mapping never reaches durable backoff.
    expect(verdict).not.toBe("succeeded");
  });
});
