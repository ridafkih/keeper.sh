import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { createDatabaseFlush } from "../../../src/core/sync-engine/flush";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import { computeSyncOperations } from "../../../src/core/sync/operations";
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

const COLUMNS_PER_ROW = 13;

const MAPPING_ID = "map-1";
const DESTINATION_EVENT_ID = "graph-event-id-1";
const ORIGINAL_UID = "original-uid@keeper.sh";
const ROTATED_UID = "rotated-uid@keeper.sh";
const ORIGINAL_START = new Date("2026-03-15T09:00:00Z");
const ORIGINAL_END = new Date("2026-03-15T10:00:00Z");
const MOVED_START = new Date("2026-03-15T14:00:00Z");
const MOVED_END = new Date("2026-03-15T15:00:00Z");

const makeEvent = (startTime: Date, endTime: Date): MaterializedSyncableEvent => ({
  id: "ev-1",
  sourceEventUid: "uid-ev-1",
  startTime,
  endTime,
  summary: "Shared calendar standup",
  calendarId: "cal-1",
  calendarName: "Test Calendar",
  calendarUrl: null,
});

const makeRemoteEvent = (uid: string, startTime: Date, endTime: Date) => ({
  deleteId: DESTINATION_EVENT_ID,
  endTime,
  isKeeperEvent: true,
  startTime,
  uid,
});

const createUidRotatingProvider = (): CalendarSyncProvider => ({
  deleteEvents: (eventIds) => Promise.resolve(eventIds.map(() => ({ success: true }))),
  listRemoteEvents: () => Promise.resolve([]),
  pushEvents: (events) =>
    Promise.resolve(events.map(() => ({
      deleteId: DESTINATION_EVENT_ID,
      remoteId: ORIGINAL_UID,
      success: true,
    }))),
  updateEvents: (updates) =>
    Promise.resolve(updates.map(() => ({
      deleteId: DESTINATION_EVENT_ID,
      remoteId: ROTATED_UID,
      success: true,
    }))),
});

type MappingColumnValues = Partial<Pick<
  EventMapping,
  "deleteIdentifier" | "destinationEventUid" | "endTime" | "startTime" | "syncEventHash" | "syncEventId"
>>;

const flushUpdatesAgainstRecorder = async (
  changes: PendingChanges,
): Promise<MappingColumnValues[]> => {
  /* The flush writes every mapping in one statement now, so the recorder reads its parameters
     rather than a per-row set. Column order is pinned by flush-binds-every-column-to-its-own-value. */
  const setValues: MappingColumnValues[] = [];
  const fakeDatabase = {
    transaction: (callback: (transaction: unknown) => Promise<void>) => callback({
      delete: () => ({ where: () => Promise.resolve() }),
      execute: (query: never) => {
        const { params } = new PgDialect().sqlToQuery(query);
        for (let index = 0; index + COLUMNS_PER_ROW <= params.length; index += COLUMNS_PER_ROW) {
          setValues.push({
            deleteIdentifier: String(params[index + 1]),
            destinationEventUid: String(params[index + 2]),
            endTime: new Date(String(params[index + 11])),
            startTime: new Date(String(params[index + 10])),
            syncEventHash: String(params[index + 3]),
            syncEventId: String(params[index + 9]),
          });
        }
        return Promise.resolve();
      },
      insert: () => ({ values: () => ({ onConflictDoNothing: () => Promise.resolve() }) }),
    }),
  };

  await createDatabaseFlush(fakeDatabase as never)(changes);

  return setValues;
};

describe("an updated event leaves the mapping pointing at it", () => {
  it("stores the destination identity returned by the update so the next pass sees no divergence", async () => {
    const provider = createUidRotatingProvider();

    const firstCycle = computeSyncOperations(
      [makeEvent(ORIGINAL_START, ORIGINAL_END)],
      [],
      [],
      TEST_RECONCILIATION_SCOPE,
    );
    const addRun = await executeRemoteOperations(firstCycle.operations, [], "dest-cal-1", provider);
    const [insert] = addRun.changes.inserts;
    if (!insert) {
      throw new Error("expected the first cycle to insert a mapping");
    }
    const mapping: EventMapping = {
      remoteAvailability: null,
      remoteContentHash: null,
      remoteEndTime: null,
      remoteStartTime: null,
      calendarId: insert.calendarId,
      deleteIdentifier: insert.deleteIdentifier,
      destinationEventUid: insert.destinationEventUid,
      endTime: insert.endTime,
      eventStateId: insert.eventStateId,
      id: MAPPING_ID,
      sourceCalendarId: insert.sourceCalendarId,
      startTime: insert.startTime,
      syncEventHash: insert.syncEventHash,
      syncEventId: insert.syncEventId,
    };
    expect(mapping.destinationEventUid).toBe(ORIGINAL_UID);

    const movedEvent = makeEvent(MOVED_START, MOVED_END);
    const secondCycle = computeSyncOperations(
      [movedEvent],
      [mapping],
      [makeRemoteEvent(ORIGINAL_UID, ORIGINAL_START, ORIGINAL_END)],
      TEST_RECONCILIATION_SCOPE,
    );
    const replacements = secondCycle.operations.filter(
      (operation): operation is Extract<SyncOperation, { type: "replace" }> => operation.type === "replace",
    );
    expect(replacements).toHaveLength(1);

    const updateRun = await executeRemoteOperations(
      secondCycle.operations,
      [mapping],
      "dest-cal-1",
      provider,
    );
    expect(updateRun.changes.updates).toHaveLength(1);
    expect(updateRun.changes.deletes).toEqual([]);
    expect(updateRun.changes.inserts).toEqual([]);

    const setValues = await flushUpdatesAgainstRecorder(updateRun.changes);
    const [written] = setValues;
    if (!written) {
      throw new Error("expected the flush to issue one mapping update");
    }
    expect(written.destinationEventUid).toBe(ROTATED_UID);

    const updatedMapping: EventMapping = { ...mapping, ...written };
    const thirdCycle = computeSyncOperations(
      [movedEvent],
      [updatedMapping],
      [makeRemoteEvent(ROTATED_UID, MOVED_START, MOVED_END)],
      TEST_RECONCILIATION_SCOPE,
    );

    expect(thirdCycle.operations).toEqual([]);
    expect(thirdCycle.staleMappingIds).toEqual([]);
  });
});
