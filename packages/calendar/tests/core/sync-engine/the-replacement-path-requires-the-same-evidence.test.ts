import { describe, expect, it } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import { createSyncEventContentHash } from "../../../src/core/events/content-hash";
import type {
  DeleteResult,
  EventPresence,
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
const CYCLES = 5;

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
  remoteAvailability: null,
  remoteContentHash: null,
  remoteEndTime: null,
  remoteStartTime: null,
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

/* The mirror is present at the destination, so the plan is an in-place update; only the update
   verb's own refusal can push this operation onto the delete-then-add path. */
const makeReplacement = (mapping: EventMapping, event: MaterializedSyncableEvent): Extract<SyncOperation, { type: "replace" }> => ({
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

interface DestinationOptions {
  refuseCreate?: PushResult;
  seeded: DestinationRecord[];
  updateFailure?: PushResult;
}

/*
 * Mirrors packages/calendar/src/providers/outlook/destination/provider.ts:358-386: a DELETE that
 * 404s is reported as { success: true } with no removal evidence, and only a 2xx DELETE carries
 * removedObject. pushEvents there is a create-only POST, so it can never land on a live object.
 */
const createOutlookLikeDestination = (options: DestinationOptions) => {
  const records = new Map<string, DestinationRecord>();
  for (const record of options.seeded) {
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
        if (options.refuseCreate) {
          return options.refuseCreate;
        }
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
      if (options.updateFailure) {
        return options.updateFailure;
      }
      const existing = records.get(update.deleteId);
      if (!existing) {
        return { error: "not found", errorType: "MicrosoftGraphHttpError", statusCode: 404, success: false };
      }
      records.set(update.deleteId, { ...existing, summary: update.event.summary });
      return { deleteId: update.deleteId, remoteId: existing.uid, success: true };
    })),
    verifyEventsExist: (deleteIds: string[]) => Promise.resolve(deleteIds.map((deleteId): EventPresence => {
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

/* The engine reports whatever per-mapping state it wants carried into the next cycle as a
   PendingUpdate on that mapping, so the harness replays the flush without naming the field. */
const carryMappingForward = (
  mapping: EventMapping,
  outcome: Awaited<ReturnType<typeof executeRemoteOperations>>,
): EventMapping | null => {
  if (outcome.changes.deletes.includes(mapping.id)) {
    return null;
  }
  const pendingUpdate = (outcome.changes.updates ?? []).find((update) => update.id === mapping.id);
  if (!pendingUpdate) {
    return mapping;
  }
  return { ...mapping, ...pendingUpdate, id: mapping.id } as EventMapping;
};

const runCycles = async (
  provider: CalendarSyncProvider,
  event: MaterializedSyncableEvent,
  seed: EventMapping,
  cycles: number,
): Promise<void> => {
  let mapping: EventMapping | null = seed;

  for (let cycle = 0; cycle < cycles; cycle++) {
    if (!mapping) {
      return;
    }
    const outcome = await executeRemoteOperations(
      [makeReplacement(mapping, event)],
      [mapping],
      DESTINATION_CALENDAR_ID,
      provider,
    );
    mapping = carryMappingForward(mapping, outcome);
  }
};

describe("the replacement path requires the same evidence its sibling demands", () => {
  it("never deletes for a payload the create verb would refuse just the same", async () => {
    const event = makeEvent("Quarterly review, moved");
    const mapping = makeMapping(LIVE_DELETE_ID, "stale-hash");
    const destination = createOutlookLikeDestination({
      refuseCreate: {
        error: "payload rejected",
        errorType: "MicrosoftGraphHttpError",
        statusCode: 422,
        success: false,
      },
      seeded: [{ deleteId: LIVE_DELETE_ID, summary: "Quarterly review", uid: LIVE_UID }],
      updateFailure: {
        error: "payload rejected",
        errorType: "MicrosoftGraphHttpError",
        statusCode: 422,
        success: false,
      },
    });

    await runCycles(destination.provider, event, mapping, CYCLES);

    // The identical bytes would be refused by the create verb too, so escalating can only destroy.
    expect(destination.deleteTargets).toEqual([]);
    expect(destination.pushedEvents).toEqual([]);
    expect(destination.snapshot()).toEqual([
      { deleteId: LIVE_DELETE_ID, summary: "Quarterly review", uid: LIVE_UID },
    ]);
  });

  it("never creates when a bare delete success carried no evidence anything was removed", async () => {
    const event = makeEvent("Team lunch, moved");
    const mapping = makeMapping(STALE_DELETE_ID, createSyncEventContentHash(makeEvent("Team lunch")));
    const destination = createOutlookLikeDestination({
      seeded: [{ deleteId: LIVE_DELETE_ID, summary: "Team lunch", uid: LIVE_UID }],
      updateFailure: {
        error: "not found",
        errorType: "MicrosoftGraphHttpError",
        statusCode: 404,
        success: false,
      },
    });

    await runCycles(destination.provider, event, mapping, 1);

    expect(destination.deleteTargets).toEqual([STALE_DELETE_ID]);
    // The 404 DELETE reported success, but the live event never left: a POST would duplicate it.
    expect(destination.pushedEvents).toEqual([]);
    expect(destination.snapshot()).toEqual([
      { deleteId: LIVE_DELETE_ID, summary: "Team lunch", uid: LIVE_UID },
    ]);
  });

  it("still replaces once when the evidence supports it", async () => {
    const event = makeEvent("Board sync, moved");
    const mapping = makeMapping(LIVE_DELETE_ID, "stale-hash");
    const destination = createOutlookLikeDestination({
      seeded: [{ deleteId: LIVE_DELETE_ID, summary: "Board sync", uid: LIVE_UID }],
      // No status and no transport error: ours, and it will repeat forever unless it escapes.
      updateFailure: {
        error: "no addressable update target",
        errorType: "UnaddressableTargetError",
        success: false,
      },
    });

    await runCycles(destination.provider, event, mapping, CYCLES);

    expect(destination.deleteTargets).toEqual([LIVE_DELETE_ID]);
    expect(destination.pushedEvents.map((pushed) => pushed.summary)).toEqual(["Board sync, moved"]);
    expect(destination.snapshot()).toEqual([
      { deleteId: "AAMkAGCreated1", summary: "Board sync, moved", uid: "AAMkAGCreated1" },
    ]);
  });
});
