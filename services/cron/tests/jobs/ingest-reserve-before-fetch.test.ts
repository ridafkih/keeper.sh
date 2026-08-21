import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type ingestSourcesJob from "../../src/jobs/ingest-sources";
import { NEVER_INGESTED_WEIGHT, WEIGHT_BUDGET } from "../../src/utils/ingest-weight";

/*
 * Every source must take its weighted reservation before its provider fetch
 * begins, and a source that fails between reserve and submit must release its
 * weight, or one failure parks the budget and no later source ever fetches.
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

  interface StatementRecord {
    label: "flush" | "pooled";
    text: string;
  }

  const state = {
    activeTransactionCount: 0,
    failingFetchCalendarIds: new Set<string>(),
    fetchStarts: [] as string[],
    flushGates: [] as Promise<null>[],
    icsRows: [] as IcsSourceRow[],
    maxActiveTransactionCount: 0,
    releaseCallCount: 0,
    reservationSubmitCount: 0,
    reserveRequests: [] as number[],
    segmentNames: [] as string[],
    statements: [] as StatementRecord[],
    storedEventCounts: new Map<string, number>(),
    transactionCounts: { flush: 0, pooled: 0 },
    workerOptionsLog: [] as (Record<string, unknown> | null)[],
  };

  const statementTextSeparator = " ";

  const storedIngestSeq = 0;

  const ingestSeqRows = (): unknown[] => [{ ingestSeq: storedIngestSeq }];

  const renderStatementText = (statement: unknown): string => {
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
    return collected.join(statementTextSeparator);
  };

  const containsCalendarId = (node: unknown, calendarId: string): boolean =>
    renderStatementText(node).includes(calendarId);

  const resolveBare = (fields: Record<string, unknown>, predicate: unknown): unknown[] => {
    if ("count" in fields) {
      const entry = [...state.storedEventCounts.entries()].find(
        ([calendarId]) => containsCalendarId(predicate, calendarId),
      );
      if (!entry) {
        return [{ count: 0 }];
      }
      return [{ count: entry[1] }];
    }
    return [];
  };

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
      Object.assign(Promise.resolve(resolveBare(fields, predicate)), {
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

  const createTransactionRunner = (label: "flush" | "pooled") =>
    async (callback: (transaction: unknown) => Promise<unknown>): Promise<unknown> => {
      state.transactionCounts[label] += 1;
      state.activeTransactionCount += 1;
      state.maxActiveTransactionCount = Math.max(
        state.maxActiveTransactionCount,
        state.activeTransactionCount,
      );
      try {
        const gate = state.flushGates.shift();
        if (gate) {
          await gate;
        }
        await new Promise((resolve) => { setTimeout(resolve, 5); });
        return await callback({
          execute: (statement: unknown): Promise<unknown[]> => {
            state.statements.push({ label, text: renderStatementText(statement) });
            return Promise.resolve([]);
          },
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
        });
      } finally {
        state.activeTransactionCount -= 1;
      }
    };

  const insertBuilder = {
    values: () => ({ onConflictDoUpdate: (): Promise<unknown[]> => Promise.resolve([]) }),
  };

  const pooledDatabase = {
    insert: () => insertBuilder,
    select: (fields: Record<string, unknown>) => createQueryBuilder(fields),
    transaction: createTransactionRunner("pooled"),
    update: () => updateBuilder,
  };

  const flushDatabase = {
    insert: () => insertBuilder,
    select: (fields: Record<string, unknown>) => createQueryBuilder(fields),
    transaction: createTransactionRunner("flush"),
    update: () => updateBuilder,
  };

  const enqueueDestinationSyncsForUsers = vi.fn(
    (_userIds: Set<string>) => Promise.resolve(0),
  );

  interface ReservationLike {
    release: () => void;
    submit: (item: unknown) => Promise<unknown>;
  }

  interface WorkerLike {
    close: () => Promise<void>;
    depth: () => { parkedOnBudget: number; queuedFlushes: number; writerSlotsInUse: number };
    reserve: (weight: number, signal?: AbortSignal) => Promise<ReservationLike>;
    submit: (item: unknown, signal?: AbortSignal) => Promise<unknown>;
  }

  type WorkerFactory = (
    run: (item: unknown) => Promise<unknown>,
    options?: Record<string, unknown>,
  ) => WorkerLike;

  const wrapReservation = (reservation: ReservationLike): ReservationLike => ({
    release: (): void => {
      state.releaseCallCount += 1;
      reservation.release();
    },
    submit: (item: unknown): Promise<unknown> => {
      state.reservationSubmitCount += 1;
      return reservation.submit(item);
    },
  });

  const wrapWorkerFactory = (factory: WorkerFactory): WorkerFactory =>
    (run, options) => {
      state.workerOptionsLog.push(options ?? null);
      const worker = factory(run, options);
      return {
        close: worker.close,
        depth: worker.depth,
        reserve: async (weight: number, signal?: AbortSignal): Promise<ReservationLike> => {
          state.reserveRequests.push(weight);
          const reservation = await worker.reserve(weight, signal);
          return wrapReservation(reservation);
        },
        submit: worker.submit,
      };
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
      () => Promise.resolve({ eventsAdded: 1, eventsRemoved: 0 }),
    );
  });

  return {
    enqueueDestinationSyncsForUsers,
    flushDatabase,
    ingestSource,
    pooledDatabase,
    state,
    wrapWorkerFactory,
  };
});

vi.mock("@keeper.sh/calendar", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  type MeasureSegment = <TResult>(
    name: string,
    run: () => Promise<TResult>,
  ) => Promise<TResult>;
  const actualMeasureSegment = actual.measureSegment as MeasureSegment;
  const wrappedMeasureSegment: MeasureSegment = (name, run) => {
    harness.state.segmentNames.push(name);
    return actualMeasureSegment(name, run);
  };
  return {
    ...actual,
    createSerialFlushWorker: harness.wrapWorkerFactory(
      actual.createSerialFlushWorker as Parameters<typeof harness.wrapWorkerFactory>[0],
    ),
    ingestSource: harness.ingestSource,
    measureSegment: wrappedMeasureSegment,
  };
});

vi.mock("@keeper.sh/calendar/ics", () => ({
  createIcsSourceFetcher: (options: { calendarId: string }) => ({
    fetchEvents: (): Promise<unknown> => {
      harness.state.fetchStarts.push(options.calendarId);
      if (harness.state.failingFetchCalendarIds.has(options.calendarId)) {
        return Promise.reject(new Error(`provider fetch failed for ${options.calendarId}`));
      }
      return Promise.resolve({ events: [] });
    },
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
  database: harness.pooledDatabase,
  flushDatabase: harness.flushDatabase,
  premiumService: { getUserPlan: () => Promise.resolve("pro") },
  /* The host limiter's acquire script expects [waitTimeMs, occupancy]; 0 wait grants. */
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
  enqueueDestinationSyncsForUsers: harness.enqueueDestinationSyncsForUsers,
}));

const createIcsRow = (
  calendarId: string,
  userId: string,
  ingestWindowRecordedAt: Date | null,
) => ({
  calendarId,
  ingestFutureRange: "6m",
  ingestHistoricRange: "1m",
  ingestWindowRecordedAt,
  treatFullDayTimedEventsAsAllDay: false,
  url: `https://feeds.example.net/${calendarId}.ics`,
  userId,
});

/* Enough stored events that the estimated weight clamps to the whole budget. */
const WHALE_EVENT_COUNT = 1_000_000;

let job: typeof ingestSourcesJob | null = null;

beforeAll(async () => {
  const module = await import("../../src/jobs/ingest-sources");
  job = module.default;
});

beforeEach(() => {
  harness.state.activeTransactionCount = 0;
  harness.state.failingFetchCalendarIds.clear();
  harness.state.fetchStarts.length = 0;
  harness.state.flushGates.length = 0;
  harness.state.icsRows.length = 0;
  harness.state.maxActiveTransactionCount = 0;
  harness.state.releaseCallCount = 0;
  harness.state.reservationSubmitCount = 0;
  harness.state.reserveRequests.length = 0;
  harness.state.segmentNames.length = 0;
  harness.state.statements.length = 0;
  harness.state.storedEventCounts.clear();
  harness.state.transactionCounts.flush = 0;
  harness.state.transactionCounts.pooled = 0;
  harness.enqueueDestinationSyncsForUsers.mockClear();
});

describe("reserve-before-fetch wiring", () => {
  it("constructs the flush writer with the weight budget", () => {
    // The worker is built at module load, so the log survives beforeEach resets.
    const budgeted = harness.state.workerOptionsLog.some(
      (options) => options !== null && options.budget === WEIGHT_BUDGET,
    );
    expect(budgeted).toBe(true);
  });

  it("does not start a second fetch while one source holds the whole budget", async () => {
    harness.state.icsRows.push(
      createIcsRow("calendar-first", "user-one", new Date()),
      createIcsRow("calendar-second", "user-two", new Date()),
    );
    harness.state.storedEventCounts.set("calendar-first", WHALE_EVENT_COUNT);
    harness.state.storedEventCounts.set("calendar-second", WHALE_EVENT_COUNT);

    const gate = Promise.withResolvers<null>();
    harness.state.flushGates.push(gate.promise);

    const jobRun = job?.callback() ?? Promise.resolve();
    const settled = jobRun.catch(() => null);
    try {
      await vi.waitFor(() => {
        expect(harness.state.transactionCounts.flush).toBeGreaterThan(0);
      });
      expect(harness.state.fetchStarts).toHaveLength(1);
    } finally {
      gate.resolve(null);
      await settled;
    }

    expect(harness.state.fetchStarts).toHaveLength(2);
    expect(harness.state.reserveRequests).toEqual([WEIGHT_BUDGET, WEIGHT_BUDGET]);
    expect(harness.state.reservationSubmitCount).toBe(2);
    expect(harness.state.transactionCounts.flush).toBe(2);
    expect(harness.state.transactionCounts.pooled).toBe(0);
    expect(harness.state.maxActiveTransactionCount).toBe(1);
    expect(harness.state.segmentNames).toContain("wait.flush_reserve_ms");
  });

  it("releases a failed source's weight so the next full-budget reserve proceeds", async () => {
    harness.state.icsRows.push(
      createIcsRow("calendar-doomed", "user-doomed", new Date()),
      createIcsRow("calendar-healthy", "user-healthy", new Date()),
    );
    harness.state.storedEventCounts.set("calendar-doomed", WHALE_EVENT_COUNT);
    harness.state.storedEventCounts.set("calendar-healthy", WHALE_EVENT_COUNT);
    harness.state.failingFetchCalendarIds.add("calendar-doomed");

    // Both sources reserve the whole budget, so without the release this never settles.
    await expect(job?.callback()).rejects.toThrow(
      "Calendar source ingestion completed with failures",
    );

    expect(harness.state.fetchStarts).toContain("calendar-doomed");
    expect(harness.state.fetchStarts).toContain("calendar-healthy");
    expect(harness.state.reserveRequests).toEqual([WEIGHT_BUDGET, WEIGHT_BUDGET]);
    expect(harness.state.transactionCounts.flush).toBe(1);
    expect(harness.state.releaseCallCount).toBeGreaterThanOrEqual(1);

    expect(harness.enqueueDestinationSyncsForUsers).toHaveBeenCalledTimes(1);
    const [affectedUserIds] = harness.enqueueDestinationSyncsForUsers.mock.calls[0] ?? [];
    expect([...affectedUserIds ?? []]).toEqual(["user-healthy"]);
  });

  it("reserves the heavy default weight for a never-ingested source", async () => {
    harness.state.icsRows.push(
      createIcsRow("calendar-fresh", "user-fresh", null),
    );
    // A stale stored count must not shrink a first ingest's reservation.
    harness.state.storedEventCounts.set("calendar-fresh", 1);

    await job?.callback();

    expect(harness.state.reserveRequests).toEqual([NEVER_INGESTED_WEIGHT]);
    expect(harness.state.transactionCounts.flush).toBe(1);
  });
});
