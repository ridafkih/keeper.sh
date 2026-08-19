import { describe, expect, it } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import { computeSyncOperations } from "../../../src/core/sync/operations";
import type { MaterializedSyncableEvent, SyncOperation } from "../../../src/core/types";
import type { EventMapping } from "../../../src/core/events/mappings";
import type { CalendarSyncProvider, EventUpdate, PendingChanges } from "../../../src/core/sync-engine/types";

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
  calendarId: "dest-cal-1",
  sourceCalendarId: "cal-1",
  destinationEventUid: "remote-1@keeper.sh",
  deleteIdentifier: "/calendar/remote-1@keeper.sh.ics",
  syncEventHash: "diverged-remote-hash",
  startTime: new Date("2026-03-15T09:00:00Z"),
  endTime: new Date("2026-03-15T10:00:00Z"),
});

const makeRemoteEvent = (mapping: EventMapping) => ({
  deleteId: mapping.deleteIdentifier,
  endTime: mapping.endTime,
  isKeeperEvent: true,
  startTime: mapping.startTime,
  uid: mapping.destinationEventUid,
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

const progressed: number[] = [];

describe("checkpointing an update-only run", () => {
  it("invokes the checkpoint callback when the run produced only in-place updates", async () => {
    const mapping = makeMapping();
    const { operations } = computeSyncOperations(
      [makeEvent("ev-1")],
      [mapping],
      [makeRemoteEvent(mapping)],
      TEST_RECONCILIATION_SCOPE,
    );
    expect(operations.filter((operation) => operation.type === "replace")).toHaveLength(1);
    expect(operations.filter((operation) => operation.type !== "replace")).toHaveLength(0);

    const { provider } = createRecordingProvider();
    const checkpointed: PendingChanges[] = [];

    const outcome = await executeRemoteOperations(
      operations,
      [mapping],
      "dest-cal-1",
      provider,
      () => Promise.resolve(true),
      (processed) => progressed.push(processed),
      (changes) => {
        checkpointed.push(changes);
        return Promise.resolve(true);
      },
    );

    expect(checkpointed).toHaveLength(1);
    expect(checkpointed[0]?.inserts).toEqual([]);
    expect(checkpointed[0]?.deletes).toEqual([]);
    expect(checkpointed[0]?.updates).toHaveLength(1);
    expect(outcome.checkpointRejected).toBe(false);
  });

  it("halts the run when the update-only checkpoint is rejected", async () => {
    const mapping = makeMapping();
    const { operations } = computeSyncOperations(
      [makeEvent("ev-1"), makeEvent("ev-2")],
      [mapping],
      [makeRemoteEvent(mapping)],
      TEST_RECONCILIATION_SCOPE,
    );
    const replacements = operations.filter(
      (operation): operation is Extract<SyncOperation, { type: "replace" }> => operation.type === "replace",
    );
    const adds = operations.filter((operation) => operation.type === "add");
    expect(replacements).toHaveLength(1);
    expect(adds).toHaveLength(1);

    const { deletedIds, provider, pushedEvents, updatedBatches } = createRecordingProvider();
    let checkpointCalls = 0;

    const outcome = await executeRemoteOperations(
      operations,
      [mapping],
      "dest-cal-1",
      provider,
      () => Promise.resolve(true),
      (processed) => progressed.push(processed),
      () => {
        checkpointCalls += 1;
        return Promise.resolve(false);
      },
    );

    expect(checkpointCalls).toBe(1);
    expect(outcome.checkpointRejected).toBe(true);
    expect(updatedBatches).toHaveLength(1);
    expect(pushedEvents).toEqual([]);
    expect(deletedIds).toEqual([]);
  });
});
