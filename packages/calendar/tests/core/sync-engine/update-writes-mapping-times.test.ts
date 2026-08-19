import { describe, expect, it } from "vitest";
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

const MAPPING_ID = "map-1";
const REMOTE_UID = "remote-1@keeper.sh";
const REMOTE_HREF = "https://caldav.example/calendar/remote-1@keeper.sh.ics";
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

const makeRemoteEvent = (startTime: Date, endTime: Date) => ({
  deleteId: REMOTE_HREF,
  endTime,
  isKeeperEvent: true,
  startTime,
  uid: REMOTE_UID,
});

const createUpdateCapableProvider = (): CalendarSyncProvider => ({
  deleteEvents: (eventIds) => Promise.resolve(eventIds.map(() => ({ success: true }))),
  listRemoteEvents: () => Promise.resolve([]),
  pushEvents: (events) =>
    Promise.resolve(events.map(() => ({ deleteId: REMOTE_HREF, remoteId: REMOTE_UID, success: true }))),
  updateEvents: (updates) =>
    Promise.resolve(updates.map(() => ({ deleteId: REMOTE_HREF, remoteId: REMOTE_UID, success: true }))),
});

type MappingColumnValues = Partial<Pick<
  EventMapping,
  "deleteIdentifier" | "endTime" | "startTime" | "syncEventHash" | "syncEventId"
>>;

const flushUpdatesAgainstRecorder = async (
  changes: PendingChanges,
): Promise<MappingColumnValues[]> => {
  const setValues: MappingColumnValues[] = [];
  const fakeDatabase = {
    transaction: (callback: (transaction: unknown) => Promise<void>) => callback({
      delete: () => ({ where: () => Promise.resolve() }),
      insert: () => ({ values: () => ({ onConflictDoNothing: () => Promise.resolve() }) }),
      update: () => ({
        set: (values: MappingColumnValues) => {
          setValues.push(values);
          return { where: () => Promise.resolve() };
        },
      }),
    }),
  };

  await createDatabaseFlush(fakeDatabase as never)(changes);

  return setValues;
};

describe("in-place update mapping times", () => {
  it("writes the new start and end times so the next reconciliation sees no staleness", async () => {
    const provider = createUpdateCapableProvider();

    const firstCycle = computeSyncOperations(
      [makeEvent(ORIGINAL_START, ORIGINAL_END)],
      [],
      [],
      TEST_RECONCILIATION_SCOPE,
    );
    const adds = firstCycle.operations.filter(
      (operation): operation is Extract<SyncOperation, { type: "add" }> => operation.type === "add",
    );
    expect(adds).toHaveLength(1);

    const addRun = await executeRemoteOperations(
      firstCycle.operations,
      [],
      "dest-cal-1",
      provider,
    );
    const [insert] = addRun.changes.inserts;
    if (!insert) {
      throw new Error("expected the first cycle to insert a mapping");
    }
    const mapping: EventMapping = {
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

    const movedEvent = makeEvent(MOVED_START, MOVED_END);
    const secondCycle = computeSyncOperations(
      [movedEvent],
      [mapping],
      [makeRemoteEvent(ORIGINAL_START, ORIGINAL_END)],
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

    const setValues = await flushUpdatesAgainstRecorder(updateRun.changes);
    const [written] = setValues;
    if (!written) {
      throw new Error("expected the flush to issue one mapping update");
    }
    expect(written.startTime).toEqual(MOVED_START);
    expect(written.endTime).toEqual(MOVED_END);

    const updatedMapping: EventMapping = { ...mapping, ...written };
    const thirdCycle = computeSyncOperations(
      [movedEvent],
      [updatedMapping],
      [makeRemoteEvent(MOVED_START, MOVED_END)],
      TEST_RECONCILIATION_SCOPE,
    );

    expect(thirdCycle.operations).toEqual([]);
    expect(thirdCycle.staleMappingIds).toEqual([]);
  });
});
