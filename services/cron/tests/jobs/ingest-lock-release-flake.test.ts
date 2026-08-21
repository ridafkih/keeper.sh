import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type ingestSourcesJob from "../../src/jobs/ingest-sources";

/*
 * A failed lock release must never clobber the ingest result. The release runs
 * in a finally as a bare redis.eval, so a transient Redis failure would settle a
 * fully persisted ingest as an error and drop the user's destination syncs.
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
    releaseRejections: 0,
  };

  const statementTextSeparator = " ";
  const emptyResultRows: unknown[] = [];

  const containsCalendarId = (node: unknown, calendarId: string): boolean => {
    const collected: string[] = [];
    const seen = new Set<object>();
    const visit = (candidate: unknown): void => {
      if (typeof candidate === "string") {
        collected.push(candidate);
        return;
      }
      if (!candidate || typeof candidate !== "object") {
        return;
      }
      if (seen.has(candidate)) {
        return;
      }
      seen.add(candidate);
      for (const child of Object.values(candidate)) {
        visit(child);
      }
    };
    visit(node);
    return collected.join(statementTextSeparator).includes(calendarId);
  };

  const storedIngestSeq = 0;

  const ingestSeqRows = (): unknown[] => [{ ingestSeq: storedIngestSeq }];

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
  ): Promise<unknown> => await callback({
    execute: (): Promise<unknown[]> => Promise.resolve(emptyResultRows),
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

  // One event added makes shouldPush true, so a correct pass must enqueue.
  const ingestSource = vi.fn(async (
    options: FakeIngestSourceOptions,
  ): Promise<{ eventsAdded: number; eventsRemoved: number }> => {
    await options.fetchEvents();
    return await options.withPersistenceTransaction(
      () => Promise.resolve({ eventsAdded: 1, eventsRemoved: 0 }),
    );
  });

  /*
   * Scripts are told apart by distinctive command tokens: PEXPIRE belongs only
   * to the host limiter's acquire, whose reply is [waitTimeMs, occupancy], and
   * DEL only to RELEASE, which flakes here as a transient ioredis rejection.
   */
  const redisEval = (script: string): Promise<unknown> => {
    if (script.includes("PEXPIRE")) {
      return Promise.resolve([0, 0]);
    }
    if (script.includes("LPUSH")) {
      return Promise.resolve("acquired");
    }
    if (script.includes("LRANGE")) {
      return Promise.resolve(1);
    }
    if (script.includes("LINDEX") && script.includes("signal ==")) {
      return Promise.resolve(1);
    }
    if (script.includes("LINDEX")) {
      return Promise.resolve("");
    }
    if (script.includes("EXPIRE")) {
      return Promise.resolve(1);
    }
    if (script.includes("DEL")) {
      state.releaseRejections += 1;
      return Promise.reject(new Error("Connection is closed."));
    }
    return Promise.resolve([0, 0]);
  };

  return {
    enqueueDestinationSyncsForUsers,
    flushDatabase,
    ingestSource,
    pooledDatabase,
    redisEval,
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

/* No ENCRYPTION_KEY, so the CalDAV family early-returns and only ICS sources run. */
vi.mock("../../src/env", () => ({ default: {} }));
vi.mock("../../src/context", () => ({
  flushDrainRegistry: { register: (): null => null },
  database: harness.pooledDatabase,
  flushDatabase: harness.flushDatabase,
  premiumService: { getUserPlan: () => Promise.resolve("pro") },
  refreshLockRedis: {
    eval: (script: string) => harness.redisEval(script),
    get: () => Promise.resolve(null),
  },
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

beforeAll(async () => {
  const module = await import("../../src/jobs/ingest-sources");
  job = module.default;
});

beforeEach(() => {
  harness.state.icsRows.length = 0;
  harness.state.releaseRejections = 0;
  harness.enqueueDestinationSyncsForUsers.mockClear();
});

describe("sync-lock release flake after a successful ingest", () => {
  it("keeps the successful result and still enqueues destination syncs", async () => {
    harness.state.icsRows.push({
      calendarId: "calendar-alpha",
      ingestFutureRange: "6m",
      ingestHistoricRange: "1m",
      ingestWindowRecordedAt: new Date(),
      treatFullDayTimedEventsAsAllDay: false,
      url: "https://feeds.example.net/calendar-alpha.ics",
      userId: "user-alpha",
    });

    await job?.callback();

    // The flake must actually have fired for this run to prove anything.
    expect(harness.state.releaseRejections).toBeGreaterThan(0);

    expect(harness.enqueueDestinationSyncsForUsers).toHaveBeenCalledTimes(1);
    const [enqueuedUsers] = harness.enqueueDestinationSyncsForUsers.mock.calls[0] ?? [];
    expect([...enqueuedUsers ?? []]).toContain("user-alpha");
  });
});
