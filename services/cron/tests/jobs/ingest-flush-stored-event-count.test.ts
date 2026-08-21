import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { calendarsTable } from "@keeper.sh/database/schema";
import type ingestSourcesJob from "../../src/jobs/ingest-sources";

const harness = vi.hoisted(() => {
  interface IcsSourceRow {
    calendarId: string;
    ingestFutureRange: string;
    ingestHistoricRange: string;
    ingestWindowRecordedAt: Date;
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
    existingEventRows: 0,
    icsRows: [] as IcsSourceRow[],
    persistenceWork: null as
      | ((persistence: {
          readExistingEvents: () => Promise<unknown[]>;
          flush: (changes: Record<string, unknown>) => Promise<void>;
        }) => Promise<{ eventsAdded: number; eventsRemoved: number }>)
      | null,
  };

  const storedIngestSeq = 0;

  const ingestSeqRows = (): unknown[] => [{ ingestSeq: storedIngestSeq }];

  const resolveLimited = (fields: Record<string, unknown>): unknown[] => {
    if ("url" in fields) {
      return state.icsRows.slice(0, 1).map((row) => ({
        failureCount: 0,
        ingestSeq: storedIngestSeq,
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

  const flushTransaction = (
    callback: (transaction: unknown) => Promise<unknown>,
  ): Promise<unknown> => callback({
    execute: () => Promise.resolve([]),
    select: (fields: Record<string, unknown>) => ({
      from: () => ({
        where: () => {
          const resolveRows = (): unknown[] => {
            if ("ingestSeq" in fields) {
              return ingestSeqRows();
            }
            return createExistingEventRows();
          };
          return Object.assign(Promise.resolve(resolveRows()), {
            limit: () => Promise.resolve(resolveRows()),
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

  const ingestSource = vi.fn(async (
    options: FakeIngestSourceOptions,
  ): Promise<{ eventsAdded: number; eventsRemoved: number }> => {
    await options.fetchEvents();
    const work = state.persistenceWork;
    if (!work) {
      return { eventsAdded: 0, eventsRemoved: 0 };
    }
    return await options.withPersistenceTransaction(work);
  });

  return {
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
    insertEventStatesWithConflictResolution: () => Promise.resolve(),
  };
});

vi.mock("../../src/utils/delete-event-states", () => ({
  deleteEventStatesInChunks: () => Promise.resolve(),
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
  ingestWindowRecordedAt: new Date(),
  storedEventCount: null,
  treatFullDayTimedEventsAsAllDay: false,
  url: `https://feeds.example.net/${calendarId}.ics`,
  userId,
});

const storedEventCountUpdates = () => harness.state.calendarUpdates.filter(
  (update) => "storedEventCount" in update.values,
);

let job: typeof ingestSourcesJob | null = null;

beforeAll(async () => {
  harness.calendarsTableRef.table = calendarsTable;
  const module = await import("../../src/jobs/ingest-sources");
  job = module.default;
});

beforeEach(() => {
  harness.state.calendarUpdates.length = 0;
  harness.state.existingEventRows = 0;
  harness.state.icsRows.length = 0;
  harness.state.persistenceWork = null;
});

describe("ingest flush stored-event count maintenance", () => {
  it("persists max(0, E + I - D) on the calendars row inside the flush transaction", async () => {
    harness.state.icsRows.push(createIcsRow("calendar-counted", "user-counted"));
    harness.state.existingEventRows = 5;
    harness.state.persistenceWork = async (persistence) => {
      const existing = await persistence.readExistingEvents();
      expect(existing).toHaveLength(5);
      await persistence.flush({
        deletes: ["event-0", "event-1"],
        inserts: [{ id: "new-a" }, { id: "new-b" }, { id: "new-c" }],
      });
      return { eventsAdded: 3, eventsRemoved: 2 };
    };

    await job?.callback();

    const updates = storedEventCountUpdates();
    expect(updates).toHaveLength(1);
    expect(updates[0]?.values.storedEventCount).toBe(6);
  });

  it("clamps the persisted count at zero when deletes outnumber E + I", async () => {
    harness.state.icsRows.push(createIcsRow("calendar-emptied", "user-emptied"));
    harness.state.existingEventRows = 2;
    harness.state.persistenceWork = async (persistence) => {
      await persistence.readExistingEvents();
      await persistence.flush({
        deletes: ["event-0", "event-1", "stale-a", "stale-b"],
        inserts: [],
      });
      return { eventsAdded: 0, eventsRemoved: 4 };
    };

    await job?.callback();

    const updates = storedEventCountUpdates();
    expect(updates).toHaveLength(1);
    expect(updates[0]?.values.storedEventCount).toBe(0);
  });

  it("leaves storedEventCount unwritten when the flush never read the existing events", async () => {
    harness.state.icsRows.push(createIcsRow("calendar-token-only", "user-token-only"));
    harness.state.persistenceWork = async (persistence) => {
      await persistence.flush({
        deletes: [],
        inserts: [],
        syncToken: "next-token",
      });
      return { eventsAdded: 0, eventsRemoved: 0 };
    };

    await job?.callback();

    expect(storedEventCountUpdates()).toHaveLength(0);
    expect(harness.state.calendarUpdates.length).toBeGreaterThan(0);
  });
});
