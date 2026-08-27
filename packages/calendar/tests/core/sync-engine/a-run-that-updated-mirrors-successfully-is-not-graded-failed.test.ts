import { describe, expect, it } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import { createSyncEventContentHash } from "../../../src/core/events/content-hash";
import type {
  CalendarSyncProvider,
  EventUpdate,
} from "../../../src/core/sync-engine/types";
import type {
  DeleteResult,
  EventPresence,
  EventVerificationTarget,
  MaterializedSyncableEvent,
  PushResult,
  SyncOperation,
} from "../../../src/core/types";
import type { EventMapping } from "../../../src/core/events/mappings";

const DESTINATION_CALENDAR_ID = "dest-cal-1";
const SOURCE_CALENDAR_ID = "source-cal-1";

const START_TIME = new Date("2026-04-14T09:00:00.000Z");
const END_TIME = new Date("2026-04-14T10:00:00.000Z");

const EVENT_COUNT = 10;
const EVENT_INDEXES = Array.from({ length: EVENT_COUNT }, (_value, index) => index + 1);

const REFUSED_INDEX = 7;

const mappedEvent = (index: number): MaterializedSyncableEvent => ({
  calendarId: SOURCE_CALENDAR_ID,
  calendarName: "Work",
  calendarUrl: null,
  endTime: END_TIME,
  id: `sync-event-${index}`,
  sourceEventUid: `source-uid-${index}`,
  startTime: START_TIME,
  summary: `Standup ${index}`,
});

const editedEvent = (index: number): MaterializedSyncableEvent => ({
  ...mappedEvent(index),
  summary: `Standup ${index} — moved to Thursday`,
});

const mirrorUid = (index: number): string => `mirror-uid-${index}@keeper.sh`;

const mappedDeleteId = (index: number): string => `mirror-as-mapped-${index}`;

const makeMapping = (index: number): EventMapping => ({
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier: mappedDeleteId(index),
  destinationEventUid: mirrorUid(index),
  endTime: END_TIME,
  eventStateId: `sync-event-${index}`,
  id: `mapping-${index}`,
  sourceCalendarId: SOURCE_CALENDAR_ID,
  startTime: START_TIME,
  syncEventHash: createSyncEventContentHash(mappedEvent(index)),
  syncEventId: `sync-event-${index}`,
});

const makeReplacement = (index: number): Extract<SyncOperation, { type: "replace" }> => ({
  deleteId: mappedDeleteId(index),
  event: editedEvent(index),
  staleMappingId: `mapping-${index}`,
  type: "replace",
  uid: mirrorUid(index),
});

const indexOfDeleteId = (deleteId: string): number =>
  EVENT_INDEXES.findIndex((index) => mappedDeleteId(index) === deleteId) + 1;

const TRANSIENT_REFUSAL: PushResult = {
  error: "service unavailable",
  errorType: "CalDAVHttpError",
  statusCode: 503,
  success: false,
};

const acceptInPlace = (update: EventUpdate): PushResult => ({
  deleteId: update.deleteId,
  remoteId: mirrorUid(indexOfDeleteId(update.deleteId)),
  success: true,
});

interface WriteLog {
  deleted: string[];
  pushed: string[];
  updated: string[];
}

const createInPlaceDestination = (): { log: WriteLog; provider: CalendarSyncProvider } => {
  const log: WriteLog = { deleted: [], pushed: [], updated: [] };

  const provider: CalendarSyncProvider = {
    deleteEvents: (eventIds: string[]) => {
      log.deleted.push(...eventIds);
      return Promise.resolve(eventIds.map((): DeleteResult => ({ removedObject: true, success: true })));
    },
    listRemoteEvents: () => Promise.resolve(EVENT_INDEXES.map((index) => ({
      deleteId: mappedDeleteId(index),
      endTime: END_TIME,
      isKeeperEvent: true,
      startTime: START_TIME,
      uid: mirrorUid(index),
    }))),
    pushEvents: (events) => {
      log.pushed.push(...events.map((event) => event.id));
      return Promise.resolve(events.map((): PushResult => ({
        deleteId: "created-1",
        remoteId: "created-uid-1",
        success: true,
      })));
    },
    updateEvents: (updates: EventUpdate[]) => {
      log.updated.push(...updates.map((update) => update.deleteId));
      return Promise.resolve(updates.map((update): PushResult => {
        if (indexOfDeleteId(update.deleteId) === REFUSED_INDEX) {
          return TRANSIENT_REFUSAL;
        }
        return acceptInPlace(update);
      }));
    },
  };

  return { log, provider };
};

const relocatedDeleteId = (index: number): string => `mirror-at-its-new-id-${index}`;

const createRelocatingDestination = (): { log: WriteLog; provider: CalendarSyncProvider } => {
  const log: WriteLog = { deleted: [], pushed: [], updated: [] };
  const relocatedIndexOf = (deleteId: string): number =>
    EVENT_INDEXES.findIndex((index) => relocatedDeleteId(index) === deleteId) + 1;

  const provider: CalendarSyncProvider = {
    deleteEvents: (eventIds: string[]) => {
      log.deleted.push(...eventIds);
      return Promise.resolve(eventIds.map((): DeleteResult => ({ removedObject: true, success: true })));
    },
    listRemoteEvents: () => Promise.resolve([]),
    pushEvents: (events) => {
      log.pushed.push(...events.map((event) => event.id));
      return Promise.resolve(events.map((): PushResult => ({
        deleteId: "created-1",
        remoteId: "created-uid-1",
        success: true,
      })));
    },
    updateEvents: (updates: EventUpdate[]) => {
      log.updated.push(...updates.map((update) => update.deleteId));
      return Promise.resolve(updates.map((update): PushResult => ({
        deleteId: update.deleteId,
        remoteId: mirrorUid(relocatedIndexOf(update.deleteId)),
        success: true,
      })));
    },
    verifyEventsExist: (targets: EventVerificationTarget[]) =>
      Promise.resolve(targets.map(({ deleteId }): EventPresence => {
        const index = indexOfDeleteId(deleteId);
        return {
          event: {
            deleteId: relocatedDeleteId(index),
            endTime: END_TIME,
            isKeeperEvent: true,
            startTime: START_TIME,
            uid: mirrorUid(index),
          },
          identifier: deleteId,
          status: "present",
        };
      })),
  };

  return { log, provider };
};

interface UpdateCounts {
  updated?: number;
}

const readSuccessfulUpdates = (result: object): number | undefined =>
  (result as UpdateCounts).updated;

const relocatedReplacement = (index: number): Extract<SyncOperation, { type: "replace" }> => ({
  ...makeReplacement(index),
  remoteMissing: true,
});

describe("a run that updated mirrors successfully is not graded failed", () => {
  it("reports nine delivered edits as successful work, not as an added-nothing run", async () => {
    const destination = createInPlaceDestination();
    const mappings = EVENT_INDEXES.map((index) => makeMapping(index));

    const outcome = await executeRemoteOperations(
      EVENT_INDEXES.map((index) => makeReplacement(index)),
      mappings,
      DESTINATION_CALENDAR_ID,
      destination.provider,
    );

    expect(destination.log.updated.toSorted())
      .toEqual(EVENT_INDEXES.map((index) => mappedDeleteId(index)).toSorted());

    expect(readSuccessfulUpdates(outcome.result)).toBe(EVENT_COUNT - 1);
    expect(outcome.result.addFailed).toBe(1);
    expect(outcome.result.added).toBe(0);
    expect(destination.log.pushed).toEqual([]);
    expect(destination.log.deleted).toEqual([]);
  });

  it("counts a relocation run that delivered its edits without crediting added", async () => {
    const destination = createRelocatingDestination();
    const mappings = EVENT_INDEXES.map((index) => makeMapping(index));

    const outcome = await executeRemoteOperations(
      EVENT_INDEXES.map((index) => relocatedReplacement(index)),
      mappings,
      DESTINATION_CALENDAR_ID,
      destination.provider,
    );

    expect(destination.log.updated.toSorted())
      .toEqual(EVENT_INDEXES.map((index) => relocatedDeleteId(index)).toSorted());

    expect(readSuccessfulUpdates(outcome.result)).toBe(EVENT_COUNT);
    expect(outcome.result.added).toBe(0);
    expect(destination.log.pushed).toEqual([]);
    expect(destination.log.deleted).toEqual([]);
  });
});
