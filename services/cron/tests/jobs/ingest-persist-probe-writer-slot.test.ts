import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type ingestSourcesJob from "../../src/jobs/ingest-sources";

/*
 * Pins where the persist-time currency probe's Redis I/O runs relative to the
 * flush writer's critical section. The probe is a Redis command on the
 * sync-lock client (commandTimeout 10s); if it is awaited after
 * flushDatabase.transaction has opened and pg_advisory_xact_lock has been
 * taken, a Redis brownout parks the sole flushDatabase connection, the
 * advisory lock, and the single serial writer slot for up to 10s per flush,
 * head-of-line stalling every family's persistence. The probe must therefore
 * settle before the flush transaction opens — the same hazard the dedicated
 * ADVISORY_LOCK_WAIT_BOUND_MS exists for on the pg side.
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

  interface ProbeObservation {
    advisoryLocksHeld: number;
    openFlushTransactions: number;
  }

  const state = {
    advisoryLocksHeld: 0,
    icsRows: [] as IcsSourceRow[],
    openFlushTransactions: 0,
    probeObservations: [] as ProbeObservation[],
  };

  const statementTextSeparator = " ";

  /*
   * Drizzle SQL objects carry their bound parameters as nested values, so a
   * deep string sweep is enough to identify a statement.
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

  /*
   * The flush transaction runner tracks the critical section: while the
   * callback is pending the sole flushDatabase connection is occupied, and
   * once pg_advisory_xact_lock has executed the per-calendar advisory lock is
   * held until settlement.
   */
  const flushTransaction = async (
    callback: (transaction: unknown) => Promise<unknown>,
  ): Promise<unknown> => {
    state.openFlushTransactions += 1;
    let lockTakenByThisTransaction = false;
    try {
      return await callback({
        execute: (statement: unknown): Promise<unknown[]> => {
          const text = renderStatementText(statement);
          if (text.includes("pg_advisory_xact_lock")) {
            lockTakenByThisTransaction = true;
            state.advisoryLocksHeld += 1;
          }
          return Promise.resolve([]);
        },
        select: () => ({
          from: () => ({
            where: () => Promise.resolve([]),
          }),
        }),
      });
    } finally {
      state.openFlushTransactions -= 1;
      if (lockTakenByThisTransaction) {
        state.advisoryLocksHeld -= 1;
      }
    }
  };

  const pooledDatabase = {
    select: (fields: Record<string, unknown>) => createQueryBuilder(fields),
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

  /* The lock handle's isCurrent is the Redis probe; record where it runs. */
  const isCurrent = vi.fn((): Promise<boolean> => {
    state.probeObservations.push({
      advisoryLocksHeld: state.advisoryLocksHeld,
      openFlushTransactions: state.openFlushTransactions,
    });
    return Promise.resolve(true);
  });

  return {
    enqueueDestinationSyncsForUsers,
    flushDatabase,
    isCurrent,
    pooledDatabase,
    state,
  };
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
        isCurrent: harness.isCurrent,
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
  harness.state.advisoryLocksHeld = 0;
  harness.state.icsRows.length = 0;
  harness.state.openFlushTransactions = 0;
  harness.state.probeObservations.length = 0;
  harness.enqueueDestinationSyncsForUsers.mockClear();
  harness.isCurrent.mockClear();
});

describe("persist-time currency probe placement", () => {
  it("never awaits the Redis currency probe inside the open flush transaction", async () => {
    harness.state.icsRows.push(createIcsRow("calendar-alpha", "user-alpha"));

    await job?.callback();

    /*
     * Sanity: the source ran both probes — pre-enqueue and persist-time. If
     * this drops below 2 the persist-time re-probe was removed, which is a
     * different regression (stale flushes), not a pass.
     */
    expect(harness.isCurrent.mock.calls.length).toBeGreaterThanOrEqual(2);

    /*
     * The probe is a Redis command with a 10s commandTimeout. Awaiting it
     * while the flush transaction is open (sole flushDatabase connection,
     * pg_advisory_xact_lock held, serial writer slot occupied) lets a Redis
     * brownout head-of-line stall every family's persistence at up to ~10s
     * per flush. Every probe must observe zero open flush transactions.
     */
    const probesInsideCriticalSection = harness.state.probeObservations.filter(
      (observation) => observation.openFlushTransactions > 0,
    );
    expect(probesInsideCriticalSection).toEqual([]);
  });
});
