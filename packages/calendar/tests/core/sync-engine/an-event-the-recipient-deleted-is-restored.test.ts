import { describe, expect, it } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import { computeSyncOperations } from "../../../src/core/sync/operations";
import { createSyncEventContentHash } from "../../../src/core/events/content-hash";
import type {
  DeleteResult,
  EventPresence,
  MaterializedSyncableEvent,
  PushResult,
  RemoteEvent,
} from "../../../src/core/types";
import type { CalendarSyncProvider, EventUpdate } from "../../../src/core/sync-engine/types";
import type { EventMapping } from "../../../src/core/events/mappings";

const DESTINATION_CALENDAR_ID = "dest-cal-1";
const MAPPING_ID = "map-1";
const START_TIME = new Date("2026-03-15T09:00:00Z");
const END_TIME = new Date("2026-03-15T10:00:00Z");

const GOOGLE_DELETE_ID = "goo000000000001";
const GOOGLE_UID = "goo000000000001@google.example";
const CALDAV_DELETE_ID = "/calendar/remote-1@keeper.sh.ics";
const CALDAV_UID = "remote-1@keeper.sh";
const OUTLOOK_DELETE_ID = "AAMkAGRemoteOne";
const OUTLOOK_UID = "AAMkAGRemoteOne";

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

const makeMapping = (deleteIdentifier: string, destinationEventUid: string, syncEventHash: string): EventMapping => ({
  id: MAPPING_ID,
  eventStateId: "ev-1",
  syncEventId: "ev-1",
  calendarId: DESTINATION_CALENDAR_ID,
  sourceCalendarId: "cal-1",
  destinationEventUid,
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

/* Every destination here answers a delete against an unknown identifier exactly the way a real one
   does: a bare success carrying no evidence that anything was removed. That answer is identical
   whether the recipient deleted the mirror or the mapping merely points at a stale identifier, so
   only a verification read can tell the two apart. */
const createDestination = (
  seeded: DestinationRecord[],
  verifyEventsExist?: CalendarSyncProvider["verifyEventsExist"],
) => {
  const records = new Map<string, DestinationRecord>();
  for (const record of seeded) {
    records.set(record.deleteId, record);
  }
  const deleteTargets: string[] = [];
  const updateTargets: string[] = [];
  const verifyTargets: string[] = [];
  const pushedEvents: MaterializedSyncableEvent[] = [];
  let created = 0;

  const trackedVerify = (deleteIds: string[]): Promise<EventPresence[] | RemoteEvent[]> => {
    verifyTargets.push(...deleteIds);
    if (!verifyEventsExist) {
      return Promise.resolve([]);
    }
    return verifyEventsExist(deleteIds);
  };

  const provider: CalendarSyncProvider = {
    deleteEvents: (eventIds) => {
      deleteTargets.push(...eventIds);
      return Promise.resolve(eventIds.map((eventId): DeleteResult => {
        const existing = records.get(eventId);
        if (!existing) {
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
          deleteId: `created-${created}`,
          summary: event.summary,
          uid: `created-${created}`,
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
    ...(verifyEventsExist && { verifyEventsExist: trackedVerify }),
  };

  return {
    deleteTargets,
    provider,
    pushedEvents,
    snapshot: (): DestinationRecord[] => [...records.values()],
    updateTargets,
    verifyTargets,
  };
};

const reportAbsent = (deleteIds: string[]): Promise<EventPresence[]> =>
  Promise.resolve(deleteIds.map((identifier): EventPresence => ({ identifier, status: "absent" })));

const reportUnknown = (deleteIds: string[]): Promise<EventPresence[]> =>
  Promise.resolve(deleteIds.map((identifier): EventPresence => ({ identifier, status: "unknown" })));

/* Outlook answers with the events it actually found and throws when the read itself failed. */
const reportNoneFound = (): Promise<RemoteEvent[]> => Promise.resolve([]);

const reportUnreadable = (): Promise<RemoteEvent[]> =>
  Promise.reject(new Error("Graph read failed: 503 Service Unavailable"));

const planMissingMirrorReplacement = (event: MaterializedSyncableEvent, mapping: EventMapping) => {
  // A windowed listing never enumerates the mirror, so reconciliation can only call it "missing".
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

describe("an event the recipient deleted is restored", () => {
  it("recreates the mirror when a Google verification read reports the object absent", async () => {
    const event = makeEvent("Team lunch");
    const mapping = makeMapping(GOOGLE_DELETE_ID, GOOGLE_UID, createSyncEventContentHash(event));
    const destination = createDestination([], reportAbsent);

    const outcome = await executeRemoteOperations(
      planMissingMirrorReplacement(event, mapping),
      [mapping],
      DESTINATION_CALENDAR_ID,
      destination.provider,
    );

    expect(destination.verifyTargets).toEqual([GOOGLE_DELETE_ID]);
    expect(destination.pushedEvents.map((pushed) => pushed.id)).toEqual(["ev-1"]);
    expect(outcome.result.added).toBe(1);
    expect(outcome.result.addFailed).toBe(0);

    const snapshot = destination.snapshot();
    expect(snapshot).toHaveLength(1);
    expect(outcome.changes.inserts.map((insert) => insert.deleteIdentifier)).toEqual(
      snapshot.map((record) => record.deleteId),
    );
  });

  it("recreates the mirror when a CalDAV verification read reports the object absent", async () => {
    const event = makeEvent("Team lunch");
    const mapping = makeMapping(CALDAV_DELETE_ID, CALDAV_UID, createSyncEventContentHash(event));
    const destination = createDestination([], reportAbsent);

    const outcome = await executeRemoteOperations(
      planMissingMirrorReplacement(event, mapping),
      [mapping],
      DESTINATION_CALENDAR_ID,
      destination.provider,
    );

    expect(destination.verifyTargets).toEqual([CALDAV_DELETE_ID]);
    expect(destination.pushedEvents.map((pushed) => pushed.id)).toEqual(["ev-1"]);
    expect(destination.snapshot()).toHaveLength(1);
    expect(outcome.result.added).toBe(1);
  });

  it("recreates the mirror when an Outlook verification read finds no such event", async () => {
    const event = makeEvent("Team lunch");
    const mapping = makeMapping(OUTLOOK_DELETE_ID, OUTLOOK_UID, createSyncEventContentHash(event));
    const destination = createDestination([], reportNoneFound);

    const outcome = await executeRemoteOperations(
      planMissingMirrorReplacement(event, mapping),
      [mapping],
      DESTINATION_CALENDAR_ID,
      destination.provider,
    );

    expect(destination.verifyTargets).toEqual([OUTLOOK_DELETE_ID]);
    expect(destination.pushedEvents.map((pushed) => pushed.id)).toEqual(["ev-1"]);
    expect(outcome.result.added).toBe(1);
    expect(outcome.changes.inserts.map((insert) => insert.deleteIdentifier)).toEqual(
      destination.snapshot().map((record) => record.deleteId),
    );
  });

  it("neither creates nor deletes when a Google verification read cannot determine presence", async () => {
    const event = makeEvent("Team lunch");
    const mapping = makeMapping(GOOGLE_DELETE_ID, GOOGLE_UID, createSyncEventContentHash(event));
    const live = { deleteId: GOOGLE_DELETE_ID, summary: "Team lunch", uid: GOOGLE_UID };
    const destination = createDestination([live], reportUnknown);

    await executeRemoteOperations(
      planMissingMirrorReplacement(event, mapping),
      [mapping],
      DESTINATION_CALENDAR_ID,
      destination.provider,
    );

    expect(destination.pushedEvents).toEqual([]);
    expect(destination.deleteTargets).toEqual([]);
    expect(destination.snapshot()).toEqual([live]);
  });

  it("neither creates nor deletes when a CalDAV verification read cannot determine presence", async () => {
    const event = makeEvent("Team lunch");
    const mapping = makeMapping(CALDAV_DELETE_ID, CALDAV_UID, createSyncEventContentHash(event));
    const live = { deleteId: CALDAV_DELETE_ID, summary: "Team lunch", uid: CALDAV_UID };
    const destination = createDestination([live], reportUnknown);

    await executeRemoteOperations(
      planMissingMirrorReplacement(event, mapping),
      [mapping],
      DESTINATION_CALENDAR_ID,
      destination.provider,
    );

    expect(destination.pushedEvents).toEqual([]);
    expect(destination.deleteTargets).toEqual([]);
    expect(destination.snapshot()).toEqual([live]);
  });

  /* Outlook's create is a POST with no idempotency key, so a create decided on a failed read is a
     duplicate the customer has to clean up by hand. */
  it("neither creates nor deletes when an Outlook verification read fails outright", async () => {
    const event = makeEvent("Team lunch");
    const mapping = makeMapping(OUTLOOK_DELETE_ID, OUTLOOK_UID, createSyncEventContentHash(event));
    const live = { deleteId: OUTLOOK_DELETE_ID, summary: "Team lunch", uid: OUTLOOK_UID };
    const destination = createDestination([live], reportUnreadable);

    await executeRemoteOperations(
      planMissingMirrorReplacement(event, mapping),
      [mapping],
      DESTINATION_CALENDAR_ID,
      destination.provider,
    );

    expect(destination.pushedEvents).toEqual([]);
    expect(destination.deleteTargets).toEqual([]);
    expect(destination.snapshot()).toEqual([live]);
  });
});
