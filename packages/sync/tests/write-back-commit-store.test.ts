import { describe, expect, it } from "vitest";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import {
  eventMappingsTable,
  eventStatesTable,
  eventWriteBackTombstonesTable,
} from "@keeper.sh/database/schema";
import { createDatabaseWriteBackStore } from "../src/write-back";
import type { LockedWriteBackStore, WriteBackTarget } from "../src/write-back-pass";

const MAPPING_ID = "mapping-id-1";
const EVENT_STATE_ID = "event-state-id-1";
const SOURCE_CALENDAR_ID = "source-calendar-id";
const TOMBSTONE_ID = "tombstone-id-1";
const PROJECTED_HASH = "projected-sync-event-hash";
const RETURNED_EPOCH = 3;
const RETURNED_DAILY_COUNT = 2;

const OBSERVED = {
  availability: "busy" as const,
  contentHash: "observed-content-hash",
  description: "Bring the notes",
  endTime: new Date("2027-05-11T15:00:00.000Z"),
  isAllDay: false,
  location: "Room 4",
  startTime: new Date("2027-05-11T14:00:00.000Z"),
  summary: "Quarterly review",
};

const UPDATES = {
  endTime: new Date("2027-05-11T16:00:00.000Z"),
  isAllDay: false,
  startTime: new Date("2027-05-11T15:00:00.000Z"),
  startTimeZone: "America/Toronto",
  summary: "Quarterly review, moved",
};

interface WriteCall {
  kind: "delete" | "update";
  table: unknown;
  values?: Record<string, unknown>;
}

interface LoadTargetRow {
  deleteIdentifier: string | null;
  destinationCalendarId: string;
  destinationEventUid: string;
  eventStateId: string | null;
  sourceCalendarId: string | null;
  sourceEventId: string | null;
  sourceEventUid: string | null;
}

const LOAD_TARGET_ROW: LoadTargetRow = {
  deleteIdentifier: null,
  destinationCalendarId: "destination-calendar-id",
  destinationEventUid: "destination-uid-1",
  eventStateId: EVENT_STATE_ID,
  sourceCalendarId: SOURCE_CALENDAR_ID,
  sourceEventId: "source-event-id-1",
  sourceEventUid: "source-event-uid-1",
};

/*
 * The live client resolves a where clause into a promise that also exposes returning, so
 * a fake that only models one of the two shapes cannot observe both statements the
 * commit issues.
 */
const createResolvedWrite = (row: Record<string, unknown>) => {
  const settled = Promise.resolve([row]);
  return Object.assign(settled, { returning: () => Promise.resolve([row]) });
};

const createFakeDatabase = (rows: LoadTargetRow[]) => {
  const calls: WriteCall[] = [];

  const locked = {
    delete: (table: unknown) => ({
      where: () => {
        calls.push({ kind: "delete", table });
        return Promise.resolve([]);
      },
    }),
    execute: () => Promise.resolve([]),
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve([]) }),
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          calls.push({ kind: "update", table, values });
          return createResolvedWrite({
            writeBackDailyCount: RETURNED_DAILY_COUNT,
            writeBackEpoch: RETURNED_EPOCH,
          });
        },
      }),
    }),
  };

  const database = {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({ limit: () => Promise.resolve(rows) }),
        }),
      }),
    }),
    transaction: (run: (transaction: unknown) => Promise<unknown>) => run(locked),
  } as unknown as BunSQLDatabase;

  return { calls, database };
};

const createStore = (rows: LoadTargetRow[] = [LOAD_TARGET_ROW]) => {
  const fake = createFakeDatabase(rows);
  const store = createDatabaseWriteBackStore({
    database: fake.database,
    encryptionKey: "encryption-key",
    oauthConfig: {},
    userId: "user-id",
  });
  return { calls: fake.calls, store };
};

const runLocked = <TResult>(
  store: ReturnType<typeof createStore>["store"],
  run: (locked: LockedWriteBackStore) => Promise<TResult>,
): Promise<TResult> => store.withSourceLock(SOURCE_CALENDAR_ID, run);

const findUpdate = (calls: WriteCall[], table: unknown): WriteCall | undefined =>
  calls.find((call) => call.kind === "update" && call.table === table);

describe("the commit that ends a write-back", () => {
  it("stamps the projected hash so the edit is not read back as an outbound change", async () => {
    const { calls, store } = createStore();

    await runLocked(store, (locked) =>
      locked.commitUpdate({
        eventStateId: EVENT_STATE_ID,
        mappingId: MAPPING_ID,
        observed: OBSERVED,
        projectedSyncEventHash: PROJECTED_HASH,
        updates: UPDATES,
      }));

    expect(findUpdate(calls, eventMappingsTable)?.values)
      .toMatchObject({ syncEventHash: PROJECTED_HASH });
  });

  it("records every part of the observation as one unit", async () => {
    const { calls, store } = createStore();

    await runLocked(store, (locked) =>
      locked.commitUpdate({
        eventStateId: EVENT_STATE_ID,
        mappingId: MAPPING_ID,
        observed: OBSERVED,
        projectedSyncEventHash: PROJECTED_HASH,
        updates: UPDATES,
      }));

    expect(findUpdate(calls, eventMappingsTable)?.values).toMatchObject({
      destinationAvailability: OBSERVED.availability,
      destinationContentHash: OBSERVED.contentHash,
      destinationDescription: OBSERVED.description,
      destinationEndTime: OBSERVED.endTime,
      destinationIsAllDay: OBSERVED.isAllDay,
      destinationLocation: OBSERVED.location,
      destinationStartTime: OBSERVED.startTime,
      destinationSummary: OBSERVED.summary,
    });
  });

  it("spends both budgets and clears any pending deletion", async () => {
    const { calls, store } = createStore();

    const spent = await runLocked(store, (locked) =>
      locked.commitUpdate({
        eventStateId: EVENT_STATE_ID,
        mappingId: MAPPING_ID,
        observed: OBSERVED,
        projectedSyncEventHash: PROJECTED_HASH,
        updates: UPDATES,
      }));

    const values = findUpdate(calls, eventMappingsTable)?.values ?? {};
    expect(Object.keys(values)).toEqual(expect.arrayContaining([
      "writeBackDailyCount",
      "writeBackDailyWindowStart",
      "writeBackEpoch",
      "writeBackEpochWindowStart",
    ]));
    expect(values).toMatchObject({
      missingFirstObservedAt: null,
      missingObservationCount: 0,
    });
    expect(spent).toEqual({
      writeBackDailyCount: RETURNED_DAILY_COUNT,
      writeBackEpoch: RETURNED_EPOCH,
    });
  });

  it("moves the mapping's recorded schedule to what it just wrote", async () => {
    const { calls, store } = createStore();

    await runLocked(store, (locked) =>
      locked.commitUpdate({
        eventStateId: EVENT_STATE_ID,
        mappingId: MAPPING_ID,
        observed: OBSERVED,
        projectedSyncEventHash: PROJECTED_HASH,
        updates: UPDATES,
      }));

    expect(findUpdate(calls, eventMappingsTable)?.values).toMatchObject({
      endTime: UPDATES.endTime,
      startTime: UPDATES.startTime,
    });
  });

  it("applies the same edit to the mirror Keeper.sh keeps of the source", async () => {
    const { calls, store } = createStore();

    await runLocked(store, (locked) =>
      locked.commitUpdate({
        eventStateId: EVENT_STATE_ID,
        mappingId: MAPPING_ID,
        observed: OBSERVED,
        projectedSyncEventHash: PROJECTED_HASH,
        updates: UPDATES,
      }));

    expect(findUpdate(calls, eventStatesTable)?.values).toEqual({
      endTime: UPDATES.endTime,
      isAllDay: UPDATES.isAllDay,
      startTime: UPDATES.startTime,
      startTimeZone: UPDATES.startTimeZone,
      title: UPDATES.summary,
    });
  });
});

describe("the commit that ends a deletion", () => {
  it("removes the mapping, the source mirror and marks the record applied", async () => {
    const { calls, store } = createStore();

    await runLocked(store, (locked) =>
      locked.commitDelete({
        eventStateId: EVENT_STATE_ID,
        mappingId: MAPPING_ID,
        tombstoneId: TOMBSTONE_ID,
      }));

    expect(calls.map((call) => call.kind)).toEqual(["delete", "delete", "update"]);
    expect(calls[0]?.table).toBe(eventMappingsTable);
    expect(calls[1]?.table).toBe(eventStatesTable);
    expect(findUpdate(calls, eventWriteBackTombstonesTable)?.values)
      .toMatchObject({ state: "applied" });
  });
});

describe("the target a classification is applied against", () => {
  it("falls back to the destination uid when no delete identifier was recorded", async () => {
    const { store } = createStore();

    const target = await store.loadTarget(MAPPING_ID);

    expect(target).toEqual<WriteBackTarget>({
      deleteIdentifier: LOAD_TARGET_ROW.destinationEventUid,
      destinationCalendarId: LOAD_TARGET_ROW.destinationCalendarId,
      destinationEventUid: LOAD_TARGET_ROW.destinationEventUid,
      eventStateId: EVENT_STATE_ID,
      mappingId: MAPPING_ID,
      sourceCalendarId: SOURCE_CALENDAR_ID,
      sourceEventId: LOAD_TARGET_ROW.sourceEventId,
      sourceEventUid: "source-event-uid-1",
    });
  });

  it("reports no target when the source identity is incomplete", async () => {
    const { store } = createStore([{ ...LOAD_TARGET_ROW, sourceEventUid: null }]);

    expect(await store.loadTarget(MAPPING_ID)).toBeNull();
  });
});
