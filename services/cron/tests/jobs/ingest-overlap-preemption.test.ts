import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type ingestSourcesJob from "../../src/jobs/ingest-sources";

/*
 * Cron passes take the per-calendar lock in the default preempting class, and a
 * timeout-abandoned run keeps executing after its scheduler slot is freed. The
 * next pass therefore queues as a preempting waiter, IS_CURRENT reads 0 for the
 * in-flight holder, and its finished fetch is discarded as superseded — so a
 * source slower than the cron cadence would never flush at all.
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
    fetchGates: [] as Promise<null>[],
    fetchStarts: [] as string[],
    icsRows: [] as IcsSourceRow[],
    lockAcquireAttempts: 0,
    snapshotPersistCount: 0,
    transactionCounts: { flush: 0, pooled: 0 },
  };

  const strings = new Map<string, string>();
  const lists = new Map<string, string[]>();
  const BACKGROUND_HOLDER_PREFIX = "background:";

  const readValue = (key: string): string | null => strings.get(key) ?? null;

  const runAcquireOrSignal = (args: string[]): unknown => {
    state.lockAcquireAttempts += 1;
    const lockKey = args[0] ?? "";
    const signalKey = args[1] ?? "";
    const blockerLockKey = args[2] ?? "";
    const waiterKey = args[3] ?? "";
    const holderId = args[4] ?? "";
    const checkBlocker = args[7] === "1";
    if (checkBlocker && readValue(blockerLockKey) !== null) {
      return "blocked";
    }
    const existing = readValue(signalKey);
    const waiters = (lists.get(waiterKey) ?? []).filter((waiter) => waiter !== holderId);
    waiters.unshift(holderId);
    lists.set(waiterKey, waiters);
    strings.set(signalKey, holderId);
    if (readValue(lockKey) === null) {
      strings.set(lockKey, holderId);
      return "acquired";
    }
    if (existing === null) {
      return "queued";
    }
    return "replaced";
  };

  const runCancelWaiter = (args: string[]): unknown => {
    const signalKey = args[0] ?? "";
    const waiterKey = args[1] ?? "";
    const lockKey = args[2] ?? "";
    const holderId = args[3] ?? "";
    if (readValue(lockKey) === holderId) {
      strings.delete(lockKey);
    }
    const waiters = (lists.get(waiterKey) ?? []).filter((waiter) => waiter !== holderId);
    const [nextWaiter] = waiters;
    if (nextWaiter) {
      lists.set(waiterKey, waiters);
      strings.set(signalKey, nextWaiter);
      return nextWaiter;
    }
    lists.delete(waiterKey);
    strings.delete(signalKey);
    return "";
  };

  const runConfirmAcquisition = (args: string[]): unknown => {
    const lockKey = args[0] ?? "";
    const signalKey = args[1] ?? "";
    const waiterKey = args[2] ?? "";
    const holderId = args[3] ?? "";
    const [currentWaiter] = lists.get(waiterKey) ?? [];
    if (
      readValue(lockKey) !== holderId
      || readValue(signalKey) !== holderId
      || currentWaiter !== holderId
    ) {
      return 0;
    }
    strings.delete(signalKey);
    lists.delete(waiterKey);
    return 1;
  };

  const runIsCurrent = (args: string[]): unknown => {
    const lockKey = args[0] ?? "";
    const waiterKey = args[1] ?? "";
    const holderId = args[2] ?? "";
    if (readValue(lockKey) !== holderId) {
      return 0;
    }
    const waiters = lists.get(waiterKey) ?? [];
    const preempted = waiters.some((waiter) =>
      waiter !== holderId && !waiter.startsWith(BACKGROUND_HOLDER_PREFIX));
    if (preempted) {
      return 0;
    }
    return 1;
  };

  const runRenew = (args: string[]): unknown => {
    const lockKey = args[0] ?? "";
    const holderId = args[1] ?? "";
    if (readValue(lockKey) === holderId) {
      return 1;
    }
    return 0;
  };

  const runRelease = (args: string[]): unknown => {
    const lockKey = args[0] ?? "";
    const holderId = args[1] ?? "";
    if (readValue(lockKey) === holderId) {
      strings.delete(lockKey);
      return 1;
    }
    return 0;
  };

  const lockRedis = {
    call: (): Promise<string> => Promise.resolve("OK"),
    del: (): Promise<number> => Promise.resolve(0),
    eval: (script: string, keyCount: number, ...args: string[]): Promise<unknown> => {
      const firstKey = args[0] ?? "";
      if (!firstKey.startsWith("sync:")) {
        /* The host limiter's acquire script expects [waitTimeMs, occupancy]. */
        return Promise.resolve([0, 0]);
      }
      if (script.includes("LRANGE")) {
        return Promise.resolve(runIsCurrent(args));
      }
      if (keyCount === 4 && args.length === 8) {
        return Promise.resolve(runAcquireOrSignal(args));
      }
      if (keyCount === 3 && args.length === 5) {
        return Promise.resolve(runCancelWaiter(args));
      }
      if (keyCount === 3 && args.length === 4) {
        return Promise.resolve(runConfirmAcquisition(args));
      }
      if (keyCount === 1 && args.length === 3) {
        return Promise.resolve(runRenew(args));
      }
      if (keyCount === 1 && args.length === 2) {
        return Promise.resolve(runRelease(args));
      }
      return Promise.reject(
        new Error(`Unexpected EVAL with ${keyCount} keys and ${args.length} args`),
      );
    },
    get: (key: string): Promise<string | null> => Promise.resolve(readValue(key)),
  };

  const helpers = {
    resolveBare: (fields: Record<string, unknown>): unknown[] => {
      if ("count" in fields) {
        return [{ count: 0 }];
      }
      return [];
    },
  };

  const resolveLimited = (fields: Record<string, unknown>, predicate: unknown): unknown[] => {
    if ("url" in fields) {
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
      visit(predicate);
      const text = collected.join(" ");
      const row = state.icsRows.find((candidate) => text.includes(candidate.calendarId));
      if (!row) {
        return [];
      }
      return [{ failureCount: 0, nextAttemptAt: null, ...row }];
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

  const createTransactionRunner = (label: "flush" | "pooled") =>
    async (callback: (transaction: unknown) => Promise<unknown>): Promise<unknown> => {
      state.transactionCounts[label] += 1;
      return await callback({
        execute: (): Promise<unknown[]> => Promise.resolve([]),
        select: (fields: Record<string, unknown>) => createQueryBuilder(fields),
        update: () => updateBuilder,
      });
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

  return { flushDatabase, lockRedis, pooledDatabase, state };
});

vi.mock("@keeper.sh/calendar/ics", () => ({
  createIcsSourceFetcher: (options: { calendarId: string }) => ({
    fetchEvents: async (): Promise<unknown> => {
      harness.state.fetchStarts.push(options.calendarId);
      const gate = harness.state.fetchGates.shift();
      if (gate) {
        await gate;
      }
      return {
        events: [],
        snapshot: { contentHash: "hash-1", ical: "BEGIN:VCALENDAR" },
      };
    },
  }),
  interpretFullDayTimedEventsAsAllDay: (events: unknown) => events,
  persistCalendarSnapshot: (): Promise<void> => {
    harness.state.snapshotPersistCount += 1;
    return Promise.resolve();
  },
}));

/* No ENCRYPTION_KEY, so the CalDAV family early-returns and only ICS sources run. */
vi.mock("../../src/env", () => ({ default: {} }));
vi.mock("../../src/context", () => ({
  flushDrainRegistry: { register: (): null => null },
  database: harness.pooledDatabase,
  flushDatabase: harness.flushDatabase,
  premiumService: { getUserPlan: () => Promise.resolve("pro") },
  refreshLockRedis: harness.lockRedis,
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
  harness.state.fetchGates.length = 0;
  harness.state.fetchStarts.length = 0;
  harness.state.icsRows.length = 0;
  harness.state.lockAcquireAttempts = 0;
  harness.state.snapshotPersistCount = 0;
  harness.state.transactionCounts.flush = 0;
  harness.state.transactionCounts.pooled = 0;
});

describe("overlapping cron passes on one calendar", () => {
  it("persists the in-flight pass's completed fetch despite the next pass arriving", async () => {
    harness.state.icsRows.push({
      calendarId: "calendar-slow",
      ingestFutureRange: "6m",
      ingestHistoricRange: "1m",
      ingestWindowRecordedAt: new Date(),
      treatFullDayTimedEventsAsAllDay: false,
      url: "https://feeds.example.net/calendar-slow.ics",
      userId: "user-slow",
    });

    const firstFetchGate = Promise.withResolvers<null>();
    const secondFetchGate = Promise.withResolvers<null>();
    harness.state.fetchGates.push(firstFetchGate.promise, secondFetchGate.promise);

    const firstPass = Promise.resolve(job?.callback()).catch(() => null);
    await vi.waitFor(() => {
      expect(harness.state.fetchStarts).toHaveLength(1);
    }, { timeout: 5000 });

    const secondPass = Promise.resolve(job?.callback()).catch(() => null);
    await vi.waitFor(() => {
      expect(harness.state.lockAcquireAttempts).toBeGreaterThanOrEqual(2);
    }, { timeout: 5000 });

    try {
      firstFetchGate.resolve(null);
      await firstPass;

      expect(harness.state.transactionCounts.flush).toBe(1);
      expect(harness.state.snapshotPersistCount).toBe(1);
    } finally {
      secondFetchGate.resolve(null);
      await secondPass;
    }
  });
});
