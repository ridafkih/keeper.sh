import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type ingestSourcesJob from "../../src/jobs/ingest-sources";
import { FLUSH_WRITER_CONNECTIONS } from "../../src/utils/flush-writer";

/*
 * Persistence stays on the dedicated flushDatabase and within its connections while
 * fetches stay concurrent, and each source must await its own flush.
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

  interface StatementRecord {
    label: "flush" | "pooled";
    text: string;
  }

  const state = {
    activeTransactionCount: 0,
    failingCalendarIds: new Set<string>(),
    icsRows: [] as IcsSourceRow[],
    maxActiveTransactionCount: 0,
    statements: [] as StatementRecord[],
    transactionCounts: { flush: 0, pooled: 0 },
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

  const HOLD_OPEN_FOR_OVERLAP_OBSERVATION_MS = 25;

  const createTransactionRunner = (label: "flush" | "pooled") =>
    async (callback: (transaction: unknown) => Promise<unknown>): Promise<unknown> => {
      state.transactionCounts[label] += 1;
      state.activeTransactionCount += 1;
      state.maxActiveTransactionCount = Math.max(
        state.maxActiveTransactionCount,
        state.activeTransactionCount,
      );
      try {
        await new Promise((resolve) => {
          setTimeout(resolve, HOLD_OPEN_FOR_OVERLAP_OBSERVATION_MS);
        });
        return await callback({
          execute: (statement: unknown): Promise<unknown[]> => {
            const text = renderStatementText(statement);
            state.statements.push({ label, text });
            const failing = [...state.failingCalendarIds].find(
              (calendarId) => text.includes(calendarId),
            );
            if (failing) {
              return Promise.reject(new Error(`flush transaction rejected for ${failing}`));
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
        state.activeTransactionCount -= 1;
      }
    };

  const pooledDatabase = {
    select: (fields: Record<string, unknown>) => createQueryBuilder(fields),
    transaction: createTransactionRunner("pooled"),
    update: () => updateBuilder,
  };

  const flushDatabase = {
    select: (fields: Record<string, unknown>) => createQueryBuilder(fields),
    transaction: createTransactionRunner("flush"),
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
  harness.state.activeTransactionCount = 0;
  harness.state.failingCalendarIds.clear();
  harness.state.icsRows.length = 0;
  harness.state.maxActiveTransactionCount = 0;
  harness.state.statements.length = 0;
  harness.state.transactionCounts.flush = 0;
  harness.state.transactionCounts.pooled = 0;
  harness.enqueueDestinationSyncsForUsers.mockClear();
});

describe("ingest flush writer", () => {
  it("keeps concurrent persistence transactions within the flush writer's connections", async () => {
    harness.state.icsRows.push(
      createIcsRow("calendar-alpha", "user-alpha"),
      createIcsRow("calendar-beta", "user-beta"),
    );

    await job?.callback();

    const totalTransactionCount = harness.state.transactionCounts.flush
      + harness.state.transactionCounts.pooled;
    expect(totalTransactionCount).toBe(2);
    expect(harness.state.maxActiveTransactionCount).toBeLessThanOrEqual(
      FLUSH_WRITER_CONNECTIONS,
    );
  });

  it("runs persistence against the flush database with timeouts and advisory locks inside", async () => {
    harness.state.icsRows.push(
      createIcsRow("calendar-alpha", "user-alpha"),
      createIcsRow("calendar-beta", "user-beta"),
    );

    await job?.callback();

    expect(harness.state.transactionCounts.flush).toBe(2);
    expect(harness.state.transactionCounts.pooled).toBe(0);

    const flushStatements = harness.state.statements
      .filter(({ label }) => label === "flush")
      .map(({ text }) => text);
    expect(flushStatements.some((text) => text.includes("statement_timeout"))).toBe(true);
    expect(flushStatements.some((text) =>
      text.includes("pg_advisory_xact_lock") && text.includes("calendar-alpha"))).toBe(true);
    expect(flushStatements.some((text) =>
      text.includes("pg_advisory_xact_lock") && text.includes("calendar-beta"))).toBe(true);
  });

  it("settles a source as an error when its own flush rejects, without touching its peer", async () => {
    harness.state.icsRows.push(
      createIcsRow("calendar-healthy", "user-healthy"),
      createIcsRow("calendar-doomed", "user-doomed"),
    );
    harness.state.failingCalendarIds.add("calendar-doomed");

    await expect(job?.callback()).rejects.toThrow(
      "Calendar source ingestion completed with failures",
    );

    expect(harness.state.transactionCounts.flush).toBe(2);

    expect(harness.enqueueDestinationSyncsForUsers).toHaveBeenCalledTimes(1);
    const [affectedUserIds] = harness.enqueueDestinationSyncsForUsers.mock.calls[0] ?? [];
    expect([...affectedUserIds ?? []]).toEqual(["user-healthy"]);
  });
});
