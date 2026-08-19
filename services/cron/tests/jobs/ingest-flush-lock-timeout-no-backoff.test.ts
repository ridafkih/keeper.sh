import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type ingestSourcesJob from "../../src/jobs/ingest-sources";

/*
 * A flush that loses the advisory-lock race lost it to keeper's own write-back,
 * not to the provider, whose fetch already succeeded. Escalating
 * ingestFailureCount there would push a healthy calendar's next attempt
 * exponentially out, so the bounded lock timeout must be exempt from backoff.
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
    backoffWrites: [] as Record<string, unknown>[],
    contendedCalendarIds: new Set<string>(),
    icsRows: [] as IcsSourceRow[],
  };

  const statementTextSeparator = " ";

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

  const updateStub = () => ({
    set: (payload: Record<string, unknown>) => {
      state.backoffWrites.push(payload);
      return {
        where: () => Object.assign(Promise.resolve([]), {
          returning: () => Promise.resolve([]),
        }),
      };
    },
  });

  const resolveLockedCalendarId = (text: string): string | null => {
    for (const row of state.icsRows) {
      if (text.includes(row.calendarId)) {
        return row.calendarId;
      }
    }
    return null;
  };

  /*
   * A statement_timeout cancellation reaches the client as SQLSTATE 57014, and
   * Bun's Postgres driver carries that SQLSTATE in errno rather than in code.
   */
  const flushTransaction = async (
    callback: (transaction: unknown) => Promise<unknown>,
  ): Promise<unknown> => await callback({
    execute: (statement: unknown): Promise<unknown[]> => {
      const text = renderStatementText(statement);
      if (text.includes("pg_advisory_xact_lock")) {
        const calendarId = resolveLockedCalendarId(text);
        if (calendarId && state.contendedCalendarIds.has(calendarId)) {
          const statementTimeout = Object.assign(
            new Error("canceling statement due to statement timeout"),
            { code: "ERR_POSTGRES_SERVER_ERROR", errno: "57014" },
          );
          return Promise.reject(statementTimeout);
        }
      }
      return Promise.resolve([]);
    },
  });

  const pooledDatabase = {
    select: (fields: Record<string, unknown>) => createQueryBuilder(fields),
    transaction: flushTransaction,
    update: updateStub,
  };

  const flushDatabase = {
    select: (fields: Record<string, unknown>) => createQueryBuilder(fields),
    transaction: flushTransaction,
    update: updateStub,
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
  harness.state.backoffWrites.length = 0;
  harness.state.contendedCalendarIds.clear();
  harness.state.icsRows.length = 0;
  harness.enqueueDestinationSyncsForUsers.mockClear();
});

describe("ingest flush advisory-lock statement timeout", () => {
  it("does not apply provider backoff when the bounded lock wait times out (57014)", async () => {
    harness.state.icsRows.push(createIcsRow("calendar-wedged", "user-wedged"));
    harness.state.contendedCalendarIds.add("calendar-wedged");

    await expect(job?.callback()).rejects.toThrow(
      "Calendar source ingestion completed with failures",
    );

    const escalations = harness.state.backoffWrites.filter(
      (payload) => typeof payload.ingestFailureCount === "number"
        && payload.ingestFailureCount >= 1,
    );
    expect(escalations).toEqual([]);
  });
});
