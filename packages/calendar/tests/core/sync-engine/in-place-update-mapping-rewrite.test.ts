import { describe, expect, it } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import { computeSyncOperations } from "../../../src/core/sync/operations";
import { createSyncEventContentHash } from "../../../src/core/events/content-hash";
import type { MaterializedSyncableEvent, SyncOperation } from "../../../src/core/types";
import type { EventMapping } from "../../../src/core/events/mappings";
import type { CalendarSyncProvider, PendingChanges } from "../../../src/core/sync-engine/types";

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

const MAPPING_ID = "map-1";
const EXISTING_DELETE_IDENTIFIER = "/calendar/remote-1@keeper.sh.ics";
const CANONICAL_DELETE_IDENTIFIER = "https://caldav.example/calendar/remote-1@keeper.sh.ics";

const makeEvent = (): MaterializedSyncableEvent => ({
  id: "ev-1",
  sourceEventUid: "uid-ev-1",
  startTime: new Date("2026-03-15T09:00:00Z"),
  endTime: new Date("2026-03-15T10:00:00Z"),
  summary: "Event ev-1 renamed",
  calendarId: "cal-1",
  calendarName: "Test Calendar",
  calendarUrl: null,
});

const makeMapping = (): EventMapping => ({
  id: MAPPING_ID,
  eventStateId: "ev-1",
  syncEventId: "ev-1",
  calendarId: "dest-cal-1",
  sourceCalendarId: "cal-1",
  destinationEventUid: "remote-1@keeper.sh",
  deleteIdentifier: EXISTING_DELETE_IDENTIFIER,
  syncEventHash: "diverged-remote-hash",
  startTime: new Date("2026-03-15T09:00:00Z"),
  endTime: new Date("2026-03-15T10:00:00Z"),
});

const createUpdateCapableProvider = (): CalendarSyncProvider => ({
  deleteEvents: (eventIds) => Promise.resolve(eventIds.map(() => ({ success: true }))),
  listRemoteEvents: () => Promise.resolve([]),
  pushEvents: (events) => Promise.resolve(events.map((event) => ({ remoteId: event.id, success: true }))),
  updateEvents: (updates) =>
    Promise.resolve(updates.map(() => ({
      deleteId: CANONICAL_DELETE_IDENTIFIER,
      remoteId: "remote-1@keeper.sh",
      success: true,
    }))),
});

describe("in-place update mapping changes", () => {
  it("rewrites the existing mapping row instead of deleting and re-inserting it", async () => {
    const event = makeEvent();
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
    expect(replacements[0]?.staleMappingId).toBe(MAPPING_ID);

    const checkpointed: PendingChanges[] = [];
    const result = await executeRemoteOperations(
      operations,
      [mapping],
      "dest-cal-1",
      createUpdateCapableProvider(),
      globalThis.undefined,
      globalThis.undefined,
      (changes) => {
        checkpointed.push(changes);
        return Promise.resolve(true);
      },
    );

    expect(checkpointed).toHaveLength(1);
    expect(checkpointed[0]?.updates).toEqual([{
      deleteIdentifier: CANONICAL_DELETE_IDENTIFIER,
      endTime: event.endTime,
      id: MAPPING_ID,
      startTime: event.startTime,
      syncEventHash: createSyncEventContentHash(event),
      syncEventId: event.id,
    }]);
    expect(checkpointed[0]?.inserts).toEqual([]);
    expect(checkpointed[0]?.deletes).toEqual([]);

    expect(result.changes.inserts).toEqual([]);
    expect(result.changes.deletes).toEqual([]);
  });
});
