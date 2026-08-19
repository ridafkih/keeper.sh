import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type ingestSourcesJob from "../../src/jobs/ingest-sources";

/*
 * Pins the head-of-line bound on the flush writer's advisory-lock wait. The
 * flush transaction takes pg_advisory_xact_lock(9003, calendarId) while holding
 * the single serial writer slot, and the same lock is held minutes-scale by
 * sync-user write-back and the API caldav persist. The wait on that lock must
 * therefore be bounded by a small constant statement_timeout (a few seconds),
 * not by the source's remaining 120s ingest deadline: one contended calendar
 * must fail ITS flush quickly so parked peers still flush inside their own
 * deadlines. The mock flushDatabase honours statement_timeout exactly like
 * Postgres does — a held lock rejects only when the in-effect timeout fires.
 */
const ADVISORY_LOCK_WAIT_BOUND_MS = 10_000;
const SIMULATED_CONTENTION_CAP_MS = 20_000;

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
    contendedCalendarIds: new Set<string>(),
    contentionCapMs: 20_000,
    icsRows: [] as IcsSourceRow[],
    lockStatementTimeoutMs: new Map<string, number>(),
    lockStatementsSeen: [] as string[],
  };

  const statementTextSeparator = " ";

  /*
   * Drizzle SQL objects carry their bound parameters (calendar ids and the
   * set_config values among them) as nested values, so a deep string sweep is
   * enough to identify a statement and read its parameters.
   */
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

  const resolveLockedCalendarId = (text: string): string | null => {
    for (const row of state.icsRows) {
      if (text.includes(row.calendarId)) {
        return row.calendarId;
      }
    }
    return null;
  };

  /*
   * The flush transaction runner models Postgres semantics for the one thing
   * under test: set_config('statement_timeout', …) changes the in-effect
   * timeout, and a pg_advisory_xact_lock held by another session (a contended
   * calendar) blocks until that in-effect timeout cancels the statement. The
   * cap keeps the simulated contention finite so an unbounded wait fails the
   * test instead of hanging the runner for the full 120s deadline.
   */
  const flushTransaction = async (
    callback: (transaction: unknown) => Promise<unknown>,
  ): Promise<unknown> => {
    let inEffectStatementTimeoutMs = 0;
    return await callback({
      execute: (statement: unknown): Promise<unknown[]> => {
        const text = renderStatementText(statement);
        if (text.includes("set_config") && text.includes("statement_timeout")
          && !text.includes("idle_in_transaction_session_timeout")) {
          const match = /\b(\d{1,9})\b/.exec(text);
          inEffectStatementTimeoutMs = Number(match?.[1] ?? 0);
          return Promise.resolve([]);
        }
        if (text.includes("pg_advisory_xact_lock")) {
          const calendarId = resolveLockedCalendarId(text);
          if (calendarId) {
            state.lockStatementsSeen.push(calendarId);
            state.lockStatementTimeoutMs.set(calendarId, inEffectStatementTimeoutMs);
            if (state.contendedCalendarIds.has(calendarId)) {
              const waitMs = Math.min(inEffectStatementTimeoutMs, state.contentionCapMs);
              return new Promise((_resolve, reject) => {
                const timer = setTimeout(
                  () => reject(new Error("canceling statement due to statement timeout")),
                  waitMs,
                );
                (timer as { unref?: () => void }).unref?.();
              });
            }
          }
        }
        return Promise.resolve([]);
      },
    });
  };

  const pooledDatabase = {
    select: (fields: Record<string, unknown>) => createQueryBuilder(fields),
    transaction: flushTransaction,
    update: () => updateBuilder,
  };

  const flushDatabase = {
    select: (fields: Record<string, unknown>) => createQueryBuilder(fields),
    transaction: flushTransaction,
    update: () => updateBuilder,
  };

  const enqueueDestinationSyncsForUsers = vi.fn(
    (_userIds: Set<string>) => Promise.resolve(0),
  );

  interface FakeIngestSourceOptions {
    calendarId: string;
    fetchEvents: () => Promise<unknown>;
    withPersistenceTransaction: (
      work: (persistence: unknown) => Promise<{ eventsAdded: number; eventsRemoved: number }>,
    ) => Promise<{ eventsAdded: number; eventsRemoved: number }>;
  }

  /*
   * The engine is not under test: fetch, then route the result through the
   * job-provided persistence transaction, exactly like the real ingestSource.
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
    enqueueDestinationSyncsForUsers,
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
  enqueueDestinationSyncsForUsers: harness.enqueueDestinationSyncsForUsers,
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
  harness.state.contendedCalendarIds.clear();
  harness.state.contentionCapMs = SIMULATED_CONTENTION_CAP_MS;
  harness.state.icsRows.length = 0;
  harness.state.lockStatementTimeoutMs.clear();
  harness.state.lockStatementsSeen.length = 0;
  harness.enqueueDestinationSyncsForUsers.mockClear();
});

describe("ingest flush advisory-lock wait bound", () => {
  it("caps the statement_timeout in effect at pg_advisory_xact_lock to a small constant", async () => {
    harness.state.icsRows.push(createIcsRow("calendar-alpha", "user-alpha"));

    await job?.callback();

    const lockTimeoutMs = harness.state.lockStatementTimeoutMs.get("calendar-alpha");
    /*
     * The lock statement must run under a bounded wait, not the source's full
     * remaining deadline: 120s here means one calendar contended by sync-user
     * write-back parks the single flush writer for two minutes.
     */
    expect(lockTimeoutMs).toBeDefined();
    expect(lockTimeoutMs ?? 0).toBeGreaterThan(0);
    expect(lockTimeoutMs ?? 0).toBeLessThanOrEqual(ADVISORY_LOCK_WAIT_BOUND_MS);
  });

  it("fails a contended calendar's flush quickly so a parked peer still flushes", async () => {
    harness.state.icsRows.push(
      createIcsRow("calendar-contended", "user-contended"),
      createIcsRow("calendar-peer", "user-peer"),
    );
    harness.state.contendedCalendarIds.add("calendar-contended");

    /* The contended source settles as its own error; the pass reports it. */
    await expect(job?.callback()).rejects.toThrow(
      "Calendar source ingestion completed with failures",
    );

    /* The peer parked behind the contended flush must still have flushed. */
    expect(harness.state.lockStatementsSeen).toContain("calendar-peer");
  }, 15_000);
});
