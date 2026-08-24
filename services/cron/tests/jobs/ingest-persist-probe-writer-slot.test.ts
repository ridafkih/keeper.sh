import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type ingestSourcesJob from "../../src/jobs/ingest-sources";

/*
 * The currency probe is a Redis command with a 10s commandTimeout, so awaiting
 * it inside the open flush transaction would let a Redis brownout hold the sole
 * flushDatabase connection, the advisory lock, and the serial writer slot for
 * 10s per flush. It must settle before the transaction opens.
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

    // Below 2 the persist-time re-probe is gone, which is a stale-flush regression, not a pass.
    expect(harness.isCurrent.mock.calls.length).toBeGreaterThanOrEqual(2);

    const probesInsideCriticalSection = harness.state.probeObservations.filter(
      (observation) => observation.openFlushTransactions > 0,
    );
    expect(probesInsideCriticalSection).toEqual([]);
  });
});
