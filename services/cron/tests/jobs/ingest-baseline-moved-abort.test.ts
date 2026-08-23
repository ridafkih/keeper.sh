import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { calendarsTable } from "@keeper.sh/database/schema";
import type ingestSourcesJob from "../../src/jobs/ingest-sources";

const harness = vi.hoisted(() => {
  interface IcsSourceRow {
    calendarId: string;
    ingestFutureRange: string;
    ingestHistoricRange: string;
    ingestSeq: number;
    ingestWindowRecordedAt: Date | null;
    storedEventCount: number | null;
    treatFullDayTimedEventsAsAllDay: boolean;
    url: string;
    userId: string;
  }

  interface CapturedCalendarUpdate {
    values: Record<string, unknown>;
  }

  const state = {
    calendarUpdates: [] as CapturedCalendarUpdate[],
    deletedIds: [] as string[],
    existingEventRows: 0,
    icsRows: [] as IcsSourceRow[],
    insertedRows: [] as unknown[],
    persistenceWork: null as
      | ((persistence: {
          readExistingEvents: () => Promise<unknown[]>;
          flush: (changes: Record<string, unknown>) => Promise<void>;
        }) => Promise<{ eventsAdded: number; eventsRemoved: number }>)
      | null,
    storedIngestSeq: 0,
  };

  const resolveLimited = (fields: Record<string, unknown>): unknown[] => {
    if ("url" in fields) {
      return state.icsRows.slice(0, 1).map((row) => ({
        failureCount: 0,
        nextAttemptAt: null,
        ...row,
      }));
    }
    return [];
  };

  const resolveListing = (fields: Record<string, unknown>): unknown[] => {
    if ("treatFullDayTimedEventsAsAllDay" in fields) {
      return state.icsRows;
    }
    return [];
  };

  const createQueryBuilder = (fields: Record<string, unknown>) => {
    const builder: Record<string, unknown> = {};
    const chain = (): unknown => builder;
    builder.from = chain;
    builder.innerJoin = chain;
    builder.leftJoin = chain;
    builder.where = () => Object.assign(Promise.resolve([]), {
      limit: () => Promise.resolve(resolveLimited(fields)),
      orderBy: () => Promise.resolve(resolveListing(fields)),
    });
    return builder;
  };

  const harness_calendarsTable = { table: null as unknown };

  const createUpdateBuilder = (table: unknown, sink: CapturedCalendarUpdate[]) => ({
    set: (values: Record<string, unknown>) => ({
      where: () => {
        if (table === harness_calendarsTable.table) {
          sink.push({ values });
        }
        return Object.assign(Promise.resolve([]), {
          returning: () => Promise.resolve([]),
        });
      },
    }),
  });

  const createExistingEventRows = (): unknown[] =>
    Array.from({ length: state.existingEventRows }, (_ignored, index) => ({
      id: `event-${index}`,
    }));

  const seqRows = (): Record<string, unknown>[] => [{
    ingestSeq: state.storedIngestSeq,
    ingest_seq: state.storedIngestSeq,
  }];

  const flushTransaction = (
    callback: (transaction: unknown) => Promise<unknown>,
  ): Promise<unknown> => callback({
    execute: () => Promise.resolve(Object.assign([...seqRows()], { rows: seqRows() })),
    select: (fields: Record<string, unknown>) => ({
      from: () => ({
        where: () => {
          const resolve = (): unknown[] => {
            if ("ingestSeq" in fields) {
              return seqRows();
            }
            return createExistingEventRows();
          };
          return Object.assign(Promise.resolve(resolve()), {
            limit: () => Promise.resolve(resolve()),
          });
        },
      }),
    }),
    update: (table: unknown) => createUpdateBuilder(table, state.calendarUpdates),
  });

  const pooledDatabase = {
    select: (fields: Record<string, unknown>) => createQueryBuilder(fields),
    transaction: flushTransaction,
    update: (table: unknown) => createUpdateBuilder(table, []),
  };

  const flushDatabase = {
    select: (fields: Record<string, unknown>) => createQueryBuilder(fields),
    transaction: flushTransaction,
    update: (table: unknown) => createUpdateBuilder(table, []),
  };

  interface FakeIngestSourceOptions {
    calendarId: string;
    fetchEvents: () => Promise<unknown>;
    withPersistenceTransaction: (
      work: (persistence: {
        readExistingEvents: () => Promise<unknown[]>;
        flush: (changes: Record<string, unknown>) => Promise<void>;
      }) => Promise<{ eventsAdded: number; eventsRemoved: number }>,
    ) => Promise<{ eventsAdded: number; eventsRemoved: number }>;
  }

  const advanceAfterFetch = { value: 0 };

  const ingestSource = vi.fn(async (
    options: FakeIngestSourceOptions,
  ): Promise<{ eventsAdded: number; eventsRemoved: number }> => {
    await options.fetchEvents();
    state.storedIngestSeq += advanceAfterFetch.value;
    const work = state.persistenceWork;
    if (!work) {
      return { eventsAdded: 0, eventsRemoved: 0 };
    }
    return await options.withPersistenceTransaction(work);
  });

  return {
    advanceAfterFetch,
    calendarsTableRef: harness_calendarsTable,
    flushDatabase,
    ingestSource,
    pooledDatabase,
    state,
  };
});

vi.mock("@keeper.sh/calendar", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    buildEventStateInsertRow: (calendarId: string, event: unknown) => ({ calendarId, event }),
    ingestSource: harness.ingestSource,
    insertEventStatesWithConflictResolution: (
      _transaction: unknown,
      rows: unknown[],
    ): Promise<void> => {
      harness.state.insertedRows.push(...rows);
      return Promise.resolve();
    },
  };
});

vi.mock("../../src/utils/delete-event-states", () => ({
  deleteEventStatesInChunks: (
    _transaction: unknown,
    _calendarId: string,
    ids: string[],
  ): Promise<void> => {
    harness.state.deletedIds.push(...ids);
    return Promise.resolve();
  },
}));

vi.mock("@keeper.sh/calendar/ics", () => ({
  createIcsSourceFetcher: () => ({
    fetchEvents: () => Promise.resolve({ events: [] }),
  }),
  interpretFullDayTimedEventsAsAllDay: (events: unknown) => events,
  persistCalendarSnapshot: () => Promise.resolve(),
}));

vi.mock("@keeper.sh/sync", () => ({
  createSyncLock: () => ({
    acquire: () => Promise.resolve({
      acquired: true,
      handle: {
        isCurrent: () => Promise.resolve(true),
        release: () => Promise.resolve(),
      },
    }),
  }),
}));

vi.mock("../../src/env", () => ({ default: {} }));
vi.mock("../../src/context", () => ({
  flushDrainRegistry: { register: (): null => null },
  database: harness.pooledDatabase,
  flushDatabase: harness.flushDatabase,
  premiumService: { getUserPlan: () => Promise.resolve("pro") },
  refreshLockRedis: { eval: () => Promise.resolve([0, 0]), get: () => Promise.resolve(null) },
  refreshLockStore: { release: () => Promise.resolve(), tryAcquire: () => Promise.resolve(true) },
}));
vi.mock("../../src/utils/logging", () => ({
  context: (callback: () => unknown) => callback(),
  widelog: {
    append: () => null,
    count: () => null,
    error: () => null,
    errorFields: () => null,
    flush: () => null,
    max: () => null,
    min: () => null,
    set: () => null,
    setFields: () => null,
    time: { measure: (_key: string, callback: () => unknown) => callback() },
  },
}));
vi.mock("../../src/utils/enqueue-destination-syncs", () => ({
  enqueueDestinationSyncsForUsers: () => Promise.resolve(0),
}));

const createIcsRow = (calendarId: string, userId: string) => ({
  calendarId,
  ingestFutureRange: "6m",
  ingestHistoricRange: "1m",
  ingestSeq: 7,
  ingestWindowRecordedAt: new Date(),
  storedEventCount: null,
  treatFullDayTimedEventsAsAllDay: false,
  url: `https://feeds.example.net/${calendarId}.ics`,
  userId,
});

const coverageChange = {
  futureRange: "6m",
  historicRange: "1m",
  window: {
    timeMax: new Date("2026-12-01T00:00:00.000Z"),
    timeMin: new Date("2026-01-01T00:00:00.000Z"),
  },
};

const updatesWithKey = (key: string) => harness.state.calendarUpdates.filter(
  (update) => key in update.values,
);

let job: typeof ingestSourcesJob | null = null;

beforeAll(async () => {
  harness.calendarsTableRef.table = calendarsTable;
  const module = await import("../../src/jobs/ingest-sources");
  job = module.default;
});

beforeEach(() => {
  harness.advanceAfterFetch.value = 0;
  harness.state.calendarUpdates.length = 0;
  harness.state.deletedIds.length = 0;
  harness.state.existingEventRows = 0;
  harness.state.icsRows.length = 0;
  harness.state.insertedRows.length = 0;
  harness.state.persistenceWork = null;
  harness.state.storedIngestSeq = 7;
});

describe("a pass whose baseline moved aborts instead of committing", () => {
  it("writes nothing when ingestSeq moved between the gated read and the locked transaction", async () => {
    harness.state.icsRows.push(createIcsRow("calendar-moved", "user-moved"));
    harness.state.existingEventRows = 2;
    harness.advanceAfterFetch.value = 1;
    harness.state.persistenceWork = async (persistence) => {
      await persistence.readExistingEvents();
      await persistence.flush({
        coverage: coverageChange,
        deletes: ["event-0"],
        inserts: [{ id: "fetched-a" }],
        syncToken: "token-from-stale-fetch",
      });
      return { eventsAdded: 1, eventsRemoved: 1 };
    };

    await Promise.resolve(job?.callback()).catch(() => null);

    expect(harness.state.insertedRows).toHaveLength(0);
    expect(harness.state.deletedIds).toHaveLength(0);
    expect(updatesWithKey("syncToken")).toHaveLength(0);
    expect(updatesWithKey("ingestWindowRecordedAt")).toHaveLength(0);
    expect(updatesWithKey("storedEventCount")).toHaveLength(0);
  });

  it("commits and bumps ingestSeq when the baseline is unchanged", async () => {
    harness.state.icsRows.push(createIcsRow("calendar-stable", "user-stable"));
    harness.state.existingEventRows = 2;
    harness.state.persistenceWork = async (persistence) => {
      await persistence.readExistingEvents();
      await persistence.flush({
        coverage: coverageChange,
        deletes: ["event-0"],
        inserts: [{ id: "fetched-a" }],
        syncToken: "token-from-fresh-fetch",
      });
      return { eventsAdded: 1, eventsRemoved: 1 };
    };

    await job?.callback();

    expect(harness.state.insertedRows).toHaveLength(1);
    expect(harness.state.deletedIds).toEqual(["event-0"]);
    expect(updatesWithKey("syncToken")[0]?.values.syncToken).toBe("token-from-fresh-fetch");
    expect(updatesWithKey("ingestSeq")).toHaveLength(1);
  });
});
