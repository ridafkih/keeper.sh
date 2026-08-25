import { describe, expect, it } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import { computeSyncOperations } from "../../../src/core/sync/operations";
import type { MaterializedSyncableEvent, SyncOperation } from "../../../src/core/types";
import type { EventMapping } from "../../../src/core/events/mappings";
import type { CalendarSyncProvider, EventUpdate } from "../../../src/core/sync-engine/types";

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

const makeEvent = (id: string): MaterializedSyncableEvent => ({
  id,
  sourceEventUid: `uid-${id}`,
  startTime: new Date("2026-03-15T09:00:00Z"),
  endTime: new Date("2026-03-15T10:00:00Z"),
  summary: `Event ${id} renamed`,
  calendarId: "cal-1",
  calendarName: "Test Calendar",
  calendarUrl: null,
});

const makeMapping = (): EventMapping => ({
  id: "map-1",
  eventStateId: "ev-1",
  syncEventId: "ev-1",
  remoteAvailability: null,
  remoteContentHash: null,
  remoteEndTime: null,
  remoteStartTime: null,
  calendarId: "dest-cal-1",
  sourceCalendarId: "cal-1",
  destinationEventUid: "remote-1@keeper.sh",
  deleteIdentifier: "/calendar/remote-1@keeper.sh.ics",
  syncEventHash: "diverged-remote-hash",
  startTime: new Date("2026-03-15T09:00:00Z"),
  endTime: new Date("2026-03-15T10:00:00Z"),
});

const createRecordingProvider = () => {
  const deletedIds: string[][] = [];
  const pushedEvents: MaterializedSyncableEvent[][] = [];
  const updatedBatches: EventUpdate[][] = [];

  const provider: CalendarSyncProvider = {
    deleteEvents: (eventIds) => {
      deletedIds.push(eventIds);
      return Promise.resolve(eventIds.map(() => ({ success: true })));
    },
    listRemoteEvents: () => Promise.resolve([]),
    pushEvents: (events) => {
      pushedEvents.push(events);
      return Promise.resolve(events.map((event) => ({ remoteId: event.id, success: true })));
    },
    updateEvents: (updates) => {
      updatedBatches.push(updates);
      return Promise.resolve(updates.map((update) => ({
        deleteId: update.deleteId,
        remoteId: update.event.id,
        success: true,
      })));
    },
  };

  return { deletedIds, provider, pushedEvents, updatedBatches };
};

describe("executeReplacements with an update-capable provider", () => {
  it("updates the remote object in place instead of deleting and re-adding it", async () => {
    const event = makeEvent("ev-1");
    const mapping = makeMapping();
    const remoteEvent = {
      deleteId: mapping.deleteIdentifier,
      endTime: mapping.endTime,
      isKeeperEvent: true,
      startTime: mapping.startTime,
      uid: mapping.destinationEventUid,
    };
    const { operations } = computeSyncOperations(
      [event],
      [mapping],
      [remoteEvent],
      TEST_RECONCILIATION_SCOPE,
    );
    const replacements = operations.filter(
      (operation): operation is Extract<SyncOperation, { type: "replace" }> => operation.type === "replace",
    );
    expect(replacements).toHaveLength(1);

    const { deletedIds, provider, pushedEvents, updatedBatches } = createRecordingProvider();

    await executeRemoteOperations(operations, [mapping], "dest-cal-1", provider);

    expect(deletedIds).toEqual([]);
    expect(pushedEvents).toEqual([]);
    expect(updatedBatches).toHaveLength(1);
    expect(updatedBatches[0]).toEqual([{
      deleteId: replacements[0]?.deleteId,
      event: replacements[0]?.event,
    }]);
  });
});
