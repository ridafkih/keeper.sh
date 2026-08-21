import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type ingestSourcesJob from "../../src/jobs/ingest-sources";

/*
 * An ICS ingest must acquire the per-host limiter before its feed fetch begins:
 * a working "ical" branch in resolveRateLimiter proves nothing unless the
 * limiter is threaded into the ingest path itself.
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

  const state = {
    hostFactoryHosts: [] as string[],
    icsRows: [] as IcsSourceRow[],
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

  const fakeDatabase = {
    select: (fields: Record<string, unknown>) => createQueryBuilder(fields),
    transaction: helpers.transactionRunner,
    update: () => updateBuilder,
  };

  const createHostRateLimiter = vi.fn((_redis: unknown, host: string) => {
    state.hostFactoryHosts.push(host);
    return {
      acquire: (): Promise<void> => {
        state.orderedEvents.push(`acquire:${host}`);
        return Promise.resolve();
      },
    };
  });

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

  return { createHostRateLimiter, fakeDatabase, ingestSource, state };
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
  createIcsSourceFetcher: (options: { calendarId: string }) => ({
    fetchEvents: (): Promise<unknown> => {
      harness.state.orderedEvents.push(`fetch:${options.calendarId}`);
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
  database: harness.fakeDatabase,
  flushDatabase: harness.fakeDatabase,
  premiumService: { getUserPlan: () => Promise.resolve("pro") },
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
  enqueueDestinationSyncsForUsers: () => Promise.resolve(0),
}));

let job: typeof ingestSourcesJob | null = null;

beforeAll(async () => {
  const module = await import("../../src/jobs/ingest-sources");
  job = module.default;
});

beforeEach(() => {
  harness.state.hostFactoryHosts.length = 0;
  harness.state.icsRows.length = 0;
  harness.state.orderedEvents.length = 0;
  harness.createHostRateLimiter.mockClear();
  harness.ingestSource.mockClear();
});

describe("ICS host limiter consumption", () => {
  it("acquires the feed host's limiter before the ICS HTTP fetch begins", async () => {
    harness.state.icsRows.push({
      calendarId: "calendar-ics-1",
      ingestFutureRange: "6m",
      ingestHistoricRange: "1m",
      ingestWindowRecordedAt: new Date(),
      treatFullDayTimedEventsAsAllDay: false,
      url: "https://feeds.example.net/team.ics",
      userId: "user-1",
    });

    await job?.callback();

    expect(harness.state.orderedEvents).toContain("fetch:calendar-ics-1");
    expect(harness.state.hostFactoryHosts).toEqual(["feeds.example.net"]);
    expect(harness.state.orderedEvents).toEqual([
      "acquire:feeds.example.net",
      "fetch:calendar-ics-1",
    ]);
  });
});
