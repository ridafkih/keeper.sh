import { describe, expect, it } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import { computeSyncOperations } from "../../../src/core/sync/operations";
import type { DeleteResult, MaterializedSyncableEvent, PushResult, RemoteEvent } from "../../../src/core/types";
import type { CalendarSyncProvider, EventUpdate } from "../../../src/core/sync-engine/types";
import type { EventMapping } from "../../../src/core/events/mappings";

const DESTINATION_CALENDAR_ID = "dest-cal-1";
const MAPPING_ID = "map-1";
const REMOTE_UID = "remote-1@keeper.sh";
const REMOTE_DELETE_ID = "/calendar/remote-1@keeper.sh.ics";
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

const createDestination = (seeded: DestinationRecord[]) => {
  const records = new Map<string, DestinationRecord>();
  for (const record of seeded) {
    records.set(record.deleteId, record);
  }
  const updateTargets: string[] = [];
  const deleteTargets: string[] = [];
  const pushedEvents: MaterializedSyncableEvent[] = [];

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
        const created = {
          deleteId: `/calendar/${event.sourceEventUid}@keeper.sh.ics`,
          summary: event.summary,
          uid: `${event.sourceEventUid}@keeper.sh`,
        };
        records.set(created.deleteId, created);
        return { deleteId: created.deleteId, remoteId: created.uid, success: true };
      }));
    },
    updateEvents: (updates: EventUpdate[]) => Promise.resolve(updates.map((update): PushResult => {
      updateTargets.push(update.deleteId);
      const existing = records.get(update.deleteId);
      if (existing) {
        records.set(update.deleteId, { ...existing, summary: update.event.summary });
        return { deleteId: update.deleteId, remoteId: existing.uid, success: true };
      }
      return { deleteId: update.deleteId, success: true };
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

describe("a present mirror is updated in place", () => {
  it("still updates in place when the mirror is present in the listing", async () => {
    const event = makeEvent("Team lunch renamed");
    const mapping = makeMapping("diverged-remote-hash");
    const destination = createDestination([
      { deleteId: REMOTE_DELETE_ID, summary: "Team lunch", uid: REMOTE_UID },
    ]);
    const remoteEvents = await destination.provider.listRemoteEvents(TEST_RECONCILIATION_SCOPE.authoritativeWindow);
    const { operations } = computeSyncOperations(
      [event],
      [mapping],
      remoteEvents,
      TEST_RECONCILIATION_SCOPE,
    );

    const outcome = await executeRemoteOperations(
      operations,
      [mapping],
      DESTINATION_CALENDAR_ID,
      destination.provider,
    );

    expect(destination.updateTargets).toEqual([REMOTE_DELETE_ID]);
    expect(destination.deleteTargets).toEqual([]);
    expect(destination.pushedEvents).toEqual([]);
    expect(destination.snapshot()).toEqual([
      { deleteId: REMOTE_DELETE_ID, summary: "Team lunch renamed", uid: REMOTE_UID },
    ]);
    expect(outcome.changes.updates).toHaveLength(1);
  });

  it("leaves a present mirror alone when the write fails transiently", async () => {
    const event = makeEvent("Team lunch renamed");
    const mapping = makeMapping("diverged-remote-hash");
    const destination = createDestination([
      { deleteId: REMOTE_DELETE_ID, summary: "Team lunch", uid: REMOTE_UID },
    ]);
    const remoteEvents = await destination.provider.listRemoteEvents(TEST_RECONCILIATION_SCOPE.authoritativeWindow);
    const { operations } = computeSyncOperations(
      [event],
      [mapping],
      remoteEvents,
      TEST_RECONCILIATION_SCOPE,
    );
    const throttledProvider: CalendarSyncProvider = {
      ...destination.provider,
      updateEvents: (updates) => Promise.resolve(updates.map((): PushResult => ({
        error: "service unavailable",
        errorType: "provider_unavailable",
        statusCode: 503,
        success: false,
      }))),
    };

    await executeRemoteOperations(
      operations,
      [mapping],
      DESTINATION_CALENDAR_ID,
      throttledProvider,
    );

    expect(destination.deleteTargets).toEqual([]);
    expect(destination.pushedEvents).toEqual([]);
    expect(destination.snapshot()).toEqual([
      { deleteId: REMOTE_DELETE_ID, summary: "Team lunch", uid: REMOTE_UID },
    ]);
  });
});
