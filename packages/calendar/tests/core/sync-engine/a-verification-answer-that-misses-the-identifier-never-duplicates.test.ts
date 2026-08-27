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
const START_TIME = new Date("2026-03-15T09:00:00Z");
const END_TIME = new Date("2026-03-15T10:00:00Z");

const GOOGLE_DELETE_ID = "goo000000000001";
const GOOGLE_UID = "goo000000000001@google.example";
const CALDAV_DELETE_ID = "/calendar/remote-1@keeper.sh.ics";
const CALDAV_UID = "remote-1@keeper.sh";

const OUTLOOK_MAPPED_DELETE_ID = "AAMkAGMappedAtCreateTime";
const OUTLOOK_CURRENT_DELETE_ID = "AAMkAGCurrentImmutableId";

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

const makeEvent = (): MaterializedSyncableEvent => ({
  id: "ev-1",
  sourceEventUid: "uid-ev-1",
  startTime: START_TIME,
  endTime: END_TIME,
  summary: "Team lunch",
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

const createDestination = (
  seeded: DestinationRecord[],
  verifyEventsExist: NonNullable<CalendarSyncProvider["verifyEventsExist"]>,
) => {
  const records = new Map<string, DestinationRecord>();
  for (const record of seeded) {
    records.set(record.deleteId, record);
  }
  const deleteTargets: string[] = [];
  const verifyTargets: string[] = [];
  const pushedEvents: MaterializedSyncableEvent[] = [];
  let created = 0;

  const trackedVerify = (targets: EventVerificationTarget[]): Promise<EventPresence[] | RemoteEvent[]> => {
    verifyTargets.push(...targets.map((target) => target.deleteId));
    return verifyEventsExist(targets);
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
      const existing = records.get(update.deleteId);
      if (!existing) {
        return { error: "not found", errorType: "not_found", statusCode: 404, success: false };
      }
      records.set(update.deleteId, { ...existing, summary: update.event.summary });
      return { deleteId: update.deleteId, remoteId: existing.uid, success: true };
    })),
    verifyEventsExist: trackedVerify,
  };

  return {
    deleteTargets,
    provider,
    pushedEvents,
    snapshot: (): DestinationRecord[] => [...records.values()],
    verifyTargets,
  };
};

const reportAbsent = (targets: EventVerificationTarget[]): Promise<EventPresence[]> =>
  Promise.resolve(targets.map(({ deleteId }): EventPresence => ({ identifier: deleteId, status: "absent" })));

const reportNoneFound = (): Promise<RemoteEvent[]> => Promise.resolve([]);

const reportFoundUnderCurrentIdentifier = (): Promise<RemoteEvent[]> => Promise.resolve([{
  deleteId: OUTLOOK_CURRENT_DELETE_ID,
  endTime: END_TIME,
  isKeeperEvent: true,
  startTime: START_TIME,
  uid: OUTLOOK_CURRENT_DELETE_ID,
}]);

const reportPresenceOfAnotherIdentifier = (): Promise<EventPresence[]> => Promise.resolve([{
  identifier: "goo000000000009",
  status: "absent",
}]);

const planMissingMirrorReplacement = (event: MaterializedSyncableEvent, mapping: EventMapping) => {
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

describe("a verification answer that misses the identifier never duplicates", () => {
  it("recreates the mirror when a Google verification read reports the mapped identifier absent", async () => {
    const event = makeEvent();
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
  });

  it("recreates the mirror when a CalDAV verification read reports the mapped identifier absent", async () => {
    const event = makeEvent();
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
    expect(outcome.result.added).toBe(1);
  });

  it("recreates the mirror when an Outlook verification read finds no object at all", async () => {
    const event = makeEvent();
    const mapping = makeMapping(OUTLOOK_MAPPED_DELETE_ID, OUTLOOK_MAPPED_DELETE_ID, createSyncEventContentHash(event));
    const destination = createDestination([], reportNoneFound);

    const outcome = await executeRemoteOperations(
      planMissingMirrorReplacement(event, mapping),
      [mapping],
      DESTINATION_CALENDAR_ID,
      destination.provider,
    );

    expect(destination.verifyTargets).toEqual([OUTLOOK_MAPPED_DELETE_ID]);
    expect(destination.pushedEvents.map((pushed) => pushed.id)).toEqual(["ev-1"]);
    expect(outcome.result.added).toBe(1);
  });

  it("neither creates nor deletes when an Outlook verification read answers with an object it cannot tie to the identifier asked about", async () => {
    const event = makeEvent();
    const mapping = makeMapping(OUTLOOK_MAPPED_DELETE_ID, OUTLOOK_MAPPED_DELETE_ID, createSyncEventContentHash(event));
    const live = { deleteId: OUTLOOK_CURRENT_DELETE_ID, summary: "Team lunch", uid: OUTLOOK_CURRENT_DELETE_ID };
    const destination = createDestination([live], reportFoundUnderCurrentIdentifier);

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

  it("neither creates nor deletes when a Google presence report answers about a different identifier", async () => {
    const event = makeEvent();
    const mapping = makeMapping(GOOGLE_DELETE_ID, GOOGLE_UID, createSyncEventContentHash(event));
    const live = { deleteId: GOOGLE_DELETE_ID, summary: "Team lunch", uid: GOOGLE_UID };
    const destination = createDestination([live], reportPresenceOfAnotherIdentifier);

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
