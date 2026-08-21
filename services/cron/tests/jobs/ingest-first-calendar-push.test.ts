import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { userSyncRequestsTable } from "@keeper.sh/database/schema";
import type ingestSourcesJob from "../../src/jobs/ingest-sources";

/*
 * A free user's destinations are filtered out of the enqueue unless a sync request is
 * pending, so a newly connected calendar would sit unpushed until the 30 minute free
 * cadence: the pass itself has to record the request the enqueue already honours.
 */
const harness = vi.hoisted(() => {
  interface IcsSourceRow {
    calendarId: string;
    ingestFutureRange: string;
    ingestHistoricRange: string;
    ingestWindowRecordedAt: Date | null;
    treatFullDayTimedEventsAsAllDay: boolean;
    url: string;
    userId: string;
  }

  interface InsertRecord {
    table: unknown;
    values: unknown;
  }

  const state = {
    failInserts: false,
    icsRows: [] as IcsSourceRow[],
    inserts: [] as InsertRecord[],
    orderedEvents: [] as string[],
  };

  const storedIngestSeq = 0;

  const ingestSeqRows = (): unknown[] => [{ ingestSeq: storedIngestSeq }];

  /* Grouped as properties so vi.hoisted can own capture-free helpers. */
  const helpers = {
    renderStatementText: (statement: unknown): string => {
      const collected: string[] = [];
      const seen = new Set<object>();
      const visit = (node: unknown): void => {
        if (typeof node === "string") {
          collected.push(node);
          return;
        }
        if (!node || typeof node !== "object") {
          return;
        }
        if (seen.has(node)) {
          return;
        }
        seen.add(node);
        for (const child of Object.values(node)) {
          visit(child);
        }
      };
      visit(statement);
      return collected.join(" ");
    },
    resolveBare: (fields: Record<string, unknown>): unknown[] => {
      if ("count" in fields) {
        return [{ count: 10 }];
      }
      return [];
    },
    transactionRunner: async (
      callback: (transaction: unknown) => Promise<unknown>,
    ): Promise<unknown> => await callback({
      execute: (): Promise<unknown[]> => Promise.resolve([]),
      select: (fields: Record<string, unknown>) => ({
        from: () => ({
          where: () => {
            const resolveRows = (): unknown[] => {
              if ("ingestSeq" in fields) {
                return ingestSeqRows();
              }
              return [];
            };
            return Object.assign(Promise.resolve(resolveRows()), {
              limit: () => Promise.resolve(resolveRows()),
            });
          },
        }),
      }),
    }),
  };

  const containsCalendarId = (node: unknown, calendarId: string): boolean =>
    helpers.renderStatementText(node).includes(calendarId);

  const resolveLimited = (fields: Record<string, unknown>, predicate: unknown): unknown[] => {
    if ("url" in fields) {
      const row = state.icsRows.find(
        (candidate) => containsCalendarId(predicate, candidate.calendarId),
      );
      if (!row) {
        return [];
      }
      return [{ failureCount: 0, ingestSeq: storedIngestSeq, nextAttemptAt: null, ...row }];
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
    builder.where = (predicate: unknown) =>
      Object.assign(Promise.resolve(helpers.resolveBare(fields)), {
        limit: () => Promise.resolve(resolveLimited(fields, predicate)),
        orderBy: () => Promise.resolve(resolveListing(fields)),
      });
    return builder;
  };

  const updateBuilder = {
    set: () => ({
      where: () => Object.assign(Promise.resolve([]), {
        returning: () => Promise.resolve([]),
      }),
    }),
  };

  const createInsertBuilder = (table: unknown) => ({
    values: (values: unknown) => {
      state.inserts.push({ table, values });
      state.orderedEvents.push("insert");
      if (state.failInserts) {
        return Object.assign(Promise.resolve([]), {
          onConflictDoNothing: () => Promise.reject(new Error("write failed")),
          onConflictDoUpdate: () => Promise.reject(new Error("write failed")),
          returning: () => Promise.reject(new Error("write failed")),
        });
      }
      return Object.assign(Promise.resolve([]), {
        onConflictDoNothing: () => Promise.resolve([]),
        onConflictDoUpdate: () => Promise.resolve([]),
        returning: () => Promise.resolve([]),
      });
    },
  });

  const fakeDatabase = {
    insert: (table: unknown) => createInsertBuilder(table),
    select: (fields: Record<string, unknown>) => createQueryBuilder(fields),
    transaction: helpers.transactionRunner,
    update: () => updateBuilder,
  };

  interface FakeIngestSourceOptions {
    calendarId: string;
    fetchEvents: () => Promise<unknown>;
    withPersistenceTransaction: (
      work: (persistence: unknown) => Promise<{ eventsAdded: number; eventsRemoved: number }>,
    ) => Promise<{ eventsAdded: number; eventsRemoved: number }>;
  }

  const ingestSource = vi.fn(async (
    options: FakeIngestSourceOptions,
  ): Promise<{ eventsAdded: number; eventsRemoved: number }> => {
    await options.fetchEvents();
    return await options.withPersistenceTransaction(
      () => Promise.resolve({ eventsAdded: 0, eventsRemoved: 0 }),
    );
  });

  const enqueueDestinationSyncsForUsers = vi.fn((): Promise<number> => {
    state.orderedEvents.push("enqueue");
    return Promise.resolve(0);
  });

  const createHostRateLimiter = vi.fn(() => ({ acquire: (): Promise<void> => Promise.resolve() }));

  return {
    createHostRateLimiter,
    enqueueDestinationSyncsForUsers,
    fakeDatabase,
    ingestSource,
    state,
  };
});

vi.mock("@keeper.sh/calendar", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createHostRateLimiter: harness.createHostRateLimiter,
    ingestSource: harness.ingestSource,
  };
});

vi.mock("@keeper.sh/calendar/ics", () => ({
  createIcsSourceFetcher: () => ({
    fetchEvents: (): Promise<unknown> => Promise.resolve({ events: [] }),
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

/* No ENCRYPTION_KEY, so the CalDAV family early-returns and only ICS sources run. */
vi.mock("../../src/env", () => ({ default: {} }));
vi.mock("../../src/context", () => ({
  flushDrainRegistry: { register: (): null => null },
  database: harness.fakeDatabase,
  flushDatabase: harness.fakeDatabase,
  premiumService: { getUserPlan: () => Promise.resolve("free") },
  refreshLockRedis: { eval: () => Promise.resolve(null), get: () => Promise.resolve(null) },
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
  enqueueDestinationSyncsForUsers: harness.enqueueDestinationSyncsForUsers,
}));

let job: typeof ingestSourcesJob | null = null;

const syncRequestUserIds = (): unknown[] =>
  harness.state.inserts
    .filter(({ table }) => table === userSyncRequestsTable)
    .map(({ values }) => (values as { userId?: unknown }).userId);

beforeAll(async () => {
  const module = await import("../../src/jobs/ingest-sources");
  job = module.default;
});

beforeEach(() => {
  harness.state.failInserts = false;
  harness.state.icsRows.length = 0;
  harness.state.inserts.length = 0;
  harness.state.orderedEvents.length = 0;
  harness.enqueueDestinationSyncsForUsers.mockClear();
  harness.ingestSource.mockClear();
});

describe("a newly connected calendar pushes immediately", () => {
  it("records a sync request for a never-ingested calendar's user before enqueueing", async () => {
    harness.state.icsRows.push({
      calendarId: "calendar-new",
      ingestFutureRange: "6m",
      ingestHistoricRange: "1m",
      ingestWindowRecordedAt: null,
      treatFullDayTimedEventsAsAllDay: false,
      url: "https://feeds.example.net/new.ics",
      userId: "user-free",
    });

    await job?.callback();

    expect(syncRequestUserIds()).toEqual(["user-free"]);
    expect(harness.state.orderedEvents.indexOf("insert"))
      .toBeLessThan(harness.state.orderedEvents.indexOf("enqueue"));
  });

  it("records no sync request when every calendar in the pass has ingested before", async () => {
    harness.state.icsRows.push({
      calendarId: "calendar-established",
      ingestFutureRange: "6m",
      ingestHistoricRange: "1m",
      ingestWindowRecordedAt: new Date(),
      treatFullDayTimedEventsAsAllDay: false,
      url: "https://feeds.example.net/established.ics",
      userId: "user-free",
    });

    await job?.callback();

    expect(syncRequestUserIds()).toEqual([]);
    expect(harness.enqueueDestinationSyncsForUsers).toHaveBeenCalled();
  });

  it("still enqueues the pass when recording the request fails", async () => {
    harness.state.icsRows.push({
      calendarId: "calendar-new",
      ingestFutureRange: "6m",
      ingestHistoricRange: "1m",
      ingestWindowRecordedAt: null,
      treatFullDayTimedEventsAsAllDay: false,
      url: "https://feeds.example.net/new.ics",
      userId: "user-free",
    });
    harness.state.failInserts = true;

    await job?.callback();

    expect(harness.enqueueDestinationSyncsForUsers).toHaveBeenCalled();
  });

  it("records a sync request when a second calendar joins established ones", async () => {
    harness.state.icsRows.push({
      calendarId: "calendar-established",
      ingestFutureRange: "6m",
      ingestHistoricRange: "1m",
      ingestWindowRecordedAt: new Date(),
      treatFullDayTimedEventsAsAllDay: false,
      url: "https://feeds.example.net/established.ics",
      userId: "user-free",
    }, {
      calendarId: "calendar-second",
      ingestFutureRange: "6m",
      ingestHistoricRange: "1m",
      ingestWindowRecordedAt: null,
      treatFullDayTimedEventsAsAllDay: false,
      url: "https://feeds.example.net/second.ics",
      userId: "user-free",
    });

    await job?.callback();

    expect(syncRequestUserIds()).toEqual(["user-free"]);
  });
});
