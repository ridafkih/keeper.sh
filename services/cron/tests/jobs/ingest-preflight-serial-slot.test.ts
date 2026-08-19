import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type ingestSourcesJob from "../../src/jobs/ingest-sources";

/*
 * Pins the claim the persist-preflight comment in ingest-sources.ts makes: the
 * persist-time currency probe (Redis I/O on the sync-lock client, 10s
 * commandTimeout) "must settle here — after the queue wait, but BEFORE
 * flushDatabase.transaction opens — so a Redis brownout never parks the sole
 * flush connection, the advisory lock, or the serial writer slot".
 *
 * If that claim holds, a brownout-slow preflight on one source must not delay
 * another source's flush: the serial writer slot stays free while the probe
 * waits on Redis. This test drives two sources through the job's real
 * reservation.submit wiring and the real serial flush worker, makes source
 * alpha's preflight slow, and asserts source bravo's flush enters before
 * alpha's preflight settles.
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

  const alphaPreflightGate = Promise.withResolvers<null>();
  const alphaPreflightStarted = alphaPreflightGate.promise;
  const signalAlphaPreflightStarted = (): void => {
    alphaPreflightGate.resolve(null);
  };

  const state = {
    alphaPreflightStarted,
    icsRows: [] as IcsSourceRow[],
    signalAlphaPreflightStarted,
    timeline: [] as string[],
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

  // eslint-disable-next-line @eslint-plugin-unicorn/consistent-function-scoping -- The vi.hoisted callback runs before module initialization, so this helper cannot live at module scope.
  const sleep = (durationMs: number): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, durationMs);
    });

  interface FakeIngestSourceOptions {
    calendarId: string;
    fetchEvents: () => Promise<unknown>;
    withPersistenceTransaction: (
      work: ((persistence: unknown) => Promise<{ eventsAdded: number; eventsRemoved: number }>)
        & { preflight?: () => Promise<{ eventsAdded: number; eventsRemoved: number } | null> },
    ) => Promise<{ eventsAdded: number; eventsRemoved: number }>;
  }

  /*
   * The engine is not under test here: fetch, then route the result through
   * the job-provided persistence transaction — carrying a persist-time
   * preflight exactly like the real ingestSource does — so the job's
   * reservation.submit call site and the real serial flush worker run for
   * real. Alpha's preflight simulates a Redis brownout (a slow sync-lock
   * isCurrent probe); bravo submits only after alpha's preflight has started,
   * so the ordering between the two thunks is deterministic.
   */
  const ingestSource = vi.fn(async (
    options: FakeIngestSourceOptions,
  ): Promise<{ eventsAdded: number; eventsRemoved: number }> => {
    await options.fetchEvents();
    if (options.calendarId === "calendar-bravo") {
      await state.alphaPreflightStarted;
    }
    const runFlush = (): Promise<{ eventsAdded: number; eventsRemoved: number }> => {
      state.timeline.push(`flush-entered:${options.calendarId}`);
      return Promise.resolve({ eventsAdded: 1, eventsRemoved: 0 });
    };
    const preflight = async (): Promise<null> => {
      state.timeline.push(`preflight-started:${options.calendarId}`);
      if (options.calendarId === "calendar-alpha") {
        state.signalAlphaPreflightStarted();
        /* Simulated Redis brownout on the persist-time currency probe. */
        await sleep(1000);
      }
      state.timeline.push(`preflight-settled:${options.calendarId}`);
      return null;
    };
    return await options.withPersistenceTransaction(Object.assign(runFlush, { preflight }));
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
  return { ...actual, ingestSource: harness.ingestSource };
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
  harness.state.timeline.length = 0;
  harness.ingestSource.mockClear();
});

describe("persist-time preflight and the serial writer slot", () => {
  it("lets another source's flush proceed while one source's preflight waits on Redis", async () => {
    /* Two different users, so grouped per-user scheduling runs them concurrently. */
    harness.state.icsRows.push(createIcsRow("calendar-alpha", "user-alpha"));
    harness.state.icsRows.push(createIcsRow("calendar-bravo", "user-bravo"));

    await job?.callback();

    const { timeline } = harness.state;
    /* Both sources reached persistence for real. */
    expect(timeline).toContain("flush-entered:calendar-alpha");
    expect(timeline).toContain("flush-entered:calendar-bravo");

    /*
     * The comment above the preflight in ingest-sources.ts promises the probe
     * "never parks the sole flush connection, the advisory lock, or the
     * serial writer slot". If the serial writer slot really stays free while
     * alpha's probe waits on Redis, bravo's flush — submitted after alpha's
     * preflight began — must enter before that probe settles, instead of
     * queueing head-of-line behind the full brownout.
     */
    const bravoFlushIndex = timeline.indexOf("flush-entered:calendar-bravo");
    const alphaPreflightSettledIndex = timeline.indexOf("preflight-settled:calendar-alpha");
    expect(
      bravoFlushIndex,
      `bravo's flush was parked behind alpha's preflight; timeline: ${timeline.join(" -> ")}`,
    ).toBeLessThan(alphaPreflightSettledIndex);
  });
});
