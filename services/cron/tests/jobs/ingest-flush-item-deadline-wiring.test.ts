import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type ingestSourcesJob from "../../src/jobs/ingest-sources";

/*
 * Pins the item-carried run deadline wiring the serial flush worker documents:
 * its resolveRunDeadlineMs probe states "the production ingest caller submits
 * `() => task()` functions with a `deadlineAt` attached", so every thunk the
 * ingest job hands to reservation.submit must carry a finite numeric
 * `deadlineAt`. Without it, a wedged production flush is bounded only by the
 * generic ten-minute fallback instead of the source's own deadline.
 */
const harness = vi.hoisted(() => {
  interface IcsSourceRow {
    calendarId: string;
    ingestFutureRange: string;
    ingestHistoricRange: string;
    ingestWindowRecordedAt: Date;
    treatFullDayTimedEventsAsAllDay: boolean;
    url: string;
    userId: string;
  }

  const state = {
    icsRows: [] as IcsSourceRow[],
    submittedItems: [] as unknown[],
  };

  /*
   * Drizzle SQL objects carry their bound parameters (calendar ids among them)
   * as nested values, so a deep string sweep is enough to identify a statement.
   */
  // eslint-disable-next-line @eslint-plugin-unicorn/consistent-function-scoping -- The vi.hoisted callback runs before module initialization, so this helper cannot live at module scope.
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
    return collected.join(" ");
  };

  const containsCalendarId = (node: unknown, calendarId: string): boolean =>
    renderStatementText(node).includes(calendarId);

  const resolveLimited = (fields: Record<string, unknown>, predicate: unknown): unknown[] => {
    if ("failureCount" in fields) {
      return [{ failureCount: 0, nextAttemptAt: null }];
    }
    if ("url" in fields) {
      const row = state.icsRows.find(
        (candidate) => containsCalendarId(predicate, candidate.calendarId),
      );
      if (!row) {
        return [];
      }
      return [row];
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
    builder.where = (predicate: unknown) => Object.assign(Promise.resolve([]), {
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

  // eslint-disable-next-line @eslint-plugin-unicorn/consistent-function-scoping -- The vi.hoisted callback runs before module initialization, so this helper cannot live at module scope.
  const transactionRunner = async (
    callback: (transaction: unknown) => Promise<unknown>,
  ): Promise<unknown> => await callback({
    execute: (): Promise<unknown[]> => Promise.resolve([]),
  });

  const pooledDatabase = {
    select: (fields: Record<string, unknown>) => createQueryBuilder(fields),
    transaction: transactionRunner,
    update: () => updateBuilder,
  };

  const flushDatabase = {
    select: (fields: Record<string, unknown>) => createQueryBuilder(fields),
    transaction: transactionRunner,
    update: () => updateBuilder,
  };

  interface FakeIngestSourceOptions {
    calendarId: string;
    fetchEvents: () => Promise<unknown>;
    withPersistenceTransaction: (
      work: (persistence: unknown) => Promise<{ eventsAdded: number; eventsRemoved: number }>,
    ) => Promise<{ eventsAdded: number; eventsRemoved: number }>;
  }

  /*
   * The engine is not under test here: fetch, then route the result through
   * the job-provided persistence transaction, exactly like the real
   * ingestSource, so the job's reservation.submit call site runs for real.
   */
  const ingestSource = vi.fn(async (
    options: FakeIngestSourceOptions,
  ): Promise<{ eventsAdded: number; eventsRemoved: number }> => {
    await options.fetchEvents();
    return await options.withPersistenceTransaction(
      () => Promise.resolve({ eventsAdded: 1, eventsRemoved: 0 }),
    );
  });

  return {
    flushDatabase,
    ingestSource,
    pooledDatabase,
    state,
  };
});

vi.mock("@keeper.sh/calendar", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  interface Reservation {
    release: () => void;
    submit: (item: unknown) => Promise<unknown>;
  }
  interface Worker {
    close: () => Promise<void>;
    reserve: (weight: number, signal?: AbortSignal) => Promise<Reservation>;
    submit: (item: unknown, signal?: AbortSignal) => Promise<unknown>;
  }
  const actualCreate = actual.createSerialFlushWorker as (
    run: (item: unknown) => Promise<unknown>,
    options?: unknown,
  ) => Worker;
  /*
   * Pass-through interception: the real worker runs unchanged, but every item
   * production hands to reservation.submit is recorded for inspection.
   */
  const createSerialFlushWorker = (
    run: (item: unknown) => Promise<unknown>,
    options?: unknown,
  ): Worker => {
    const worker = actualCreate(run, options);
    return {
      close: () => worker.close(),
      reserve: async (weight: number, signal?: AbortSignal): Promise<Reservation> => {
        const reservation = await worker.reserve(weight, signal);
        return {
          release: () => { reservation.release(); },
          submit: (item: unknown): Promise<unknown> => {
            harness.state.submittedItems.push(item);
            return reservation.submit(item);
          },
        };
      },
      submit: (item: unknown, signal?: AbortSignal): Promise<unknown> => {
        harness.state.submittedItems.push(item);
        return worker.submit(item, signal);
      },
    };
  };
  return { ...actual, createSerialFlushWorker, ingestSource: harness.ingestSource };
});

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

/* No ENCRYPTION_KEY, so the CalDAV family early-returns and only ICS sources run. */
vi.mock("../../src/env", () => ({ default: {} }));
vi.mock("../../src/context", () => ({
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
  enqueueDestinationSyncsForUsers: (_userIds: Set<string>) => Promise.resolve(0),
}));

const createIcsRow = (calendarId: string, userId: string) => ({
  calendarId,
  ingestFutureRange: "6m",
  ingestHistoricRange: "1m",
  ingestWindowRecordedAt: new Date(),
  treatFullDayTimedEventsAsAllDay: false,
  url: `https://feeds.example.net/${calendarId}.ics`,
  userId,
});

let job: typeof ingestSourcesJob | null = null;

beforeAll(async () => {
  const module = await import("../../src/jobs/ingest-sources");
  job = module.default;
});

beforeEach(() => {
  harness.state.icsRows.length = 0;
  harness.state.submittedItems.length = 0;
  harness.ingestSource.mockClear();
});

describe("ingest flush item-carried deadline wiring", () => {
  it("attaches a finite deadlineAt to every thunk submitted to the flush writer", async () => {
    harness.state.icsRows.push(createIcsRow("calendar-alpha", "user-alpha"));

    await job?.callback();

    /* The source's flush went through reservation.submit for real. */
    expect(harness.state.submittedItems.length).toBeGreaterThan(0);

    /*
     * The worker's resolveRunDeadlineMs probe documents that production thunks
     * carry `deadlineAt`; a bare thunk silently falls back to the generic
     * ten-minute run deadline instead of the source's own deadline.
     */
    for (const item of harness.state.submittedItems) {
      expect(item).toHaveProperty("deadlineAt");
      const { deadlineAt } = item as { deadlineAt: unknown };
      expect(typeof deadlineAt).toBe("number");
      expect(Number.isFinite(deadlineAt)).toBe(true);
    }
  });
});
