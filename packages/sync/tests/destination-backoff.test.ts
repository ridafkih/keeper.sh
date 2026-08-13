import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const syncCalendarMock = vi.fn();
const listRemoteEventsMock = vi.fn(() => Promise.resolve([]));
const resolveSyncProviderMock = vi.fn();
const isCalendarInvalidatedMock = vi.fn(
  (_redis: unknown, _calendarId: string) => Promise.resolve(false),
);
const handleIsCurrentMock = vi.fn(() => Promise.resolve(true));
const acquireMock = vi.fn();

vi.mock("@keeper.sh/calendar", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    createDatabaseFlush: () => () => Promise.resolve(),
    createGoogleUserRateLimiter: () => null,
    getEventMappingsForDestination: () => Promise.resolve([]),
    getEventsForCalendarsWithDiagnostics: () => Promise.resolve({
      diagnostics: {
        candidateEventStateCount: 0,
        excludedBySyncPolicyCount: 0,
        materializedEventCount: 0,
        missingSourceEventUidCount: 0,
        outsideReconciliationWindowCount: 0,
        overBudgetSourceEventStateIds: [],
        overBudgetSourceEventUids: [],
        syncableEventCount: 0,
      },
      events: [],
    }),
    getMappedSourceCalendarIds: () => Promise.resolve([]),
    syncCalendar: (options: unknown) => syncCalendarMock(options),
    withSourceIngestLocks: (
      database: unknown,
      _ids: string[],
      run: (database: unknown) => Promise<unknown>,
    ) => run(database),
  };
});

vi.mock("../src/resolve-provider", () => ({
  resolveSyncProvider: (options: unknown) => resolveSyncProviderMock(options),
}));

vi.mock("../src/sync-lock", () => ({
  createMappingMutationLockId: (userId: string) => `mapping:${userId}`,
  createSyncLock: () => ({
    acquire: (calendarId: string, signal: unknown, lockId: string) =>
      acquireMock(calendarId, signal, lockId),
  }),
  isCalendarInvalidated: (redis: unknown, calendarId: string) =>
    isCalendarInvalidatedMock(redis, calendarId),
}));

const { syncDestinationsForUser } = await import("../src/sync-user");

const USER_ID = "user-1";
const CALENDAR_ID = "destination-1";
const START = new Date("2026-03-08T00:30:00.000Z");
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

interface CalendarRow {
  failureCount: number;
  lastFailureAt: Date | null;
  nextAttemptAt: Date | null;
}

interface SyncOutcome {
  added?: number;
  addFailed?: number;
  conflictsResolved?: number;
  removed?: number;
  removeFailed?: number;
  errors?: string[];
}

const createHarness = (initial: Partial<CalendarRow> = {}) => {
  const row: CalendarRow = {
    failureCount: 0,
    lastFailureAt: null,
    nextAttemptAt: null,
    ...initial,
  };
  const writes: Partial<CalendarRow>[] = [];

  const attemptRow = () => ({
    accountId: "account-1",
    calendarId: CALENDAR_ID,
    failureCount: row.failureCount,
    nextAttemptAt: row.nextAttemptAt,
    provider: "google",
    syncFutureRange: "12_months",
    syncHistoricRange: "1_month",
    userId: USER_ID,
  });

  const database = {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({ limit: () => Promise.resolve([attemptRow()]) }),
        }),
        where: () => Promise.resolve([{ calendarId: CALENDAR_ID }]),
      }),
    }),
    update: () => ({
      set: (values: Partial<CalendarRow>) => ({
        where: () => {
          writes.push({ ...values });
          Object.assign(row, values);
          return Promise.resolve();
        },
      }),
    }),
  };

  return { database, row, writes };
};

const config = (database: unknown) => ({
  destinationCalendarId: CALENDAR_ID,
  database: database as never,
  redis: {} as never,
  oauthConfig: {} as never,
  plan: "pro" as never,
});

const EMPTY_SYNC_RESULT = {
  added: 0,
  addFailed: 0,
  conflictsResolved: 0,
  removed: 0,
  removeFailed: 0,
  errors: [],
};

/*
 * SyncCalendar checks isCurrent() before touching the provider and returns an
 * all-zero result when the run has been superseded, so the double is only
 * faithful if it does the same.
 */
const setOutcome = (outcome: SyncOutcome) => {
  syncCalendarMock.mockImplementation(async (options: {
    isCurrent: () => Promise<boolean>;
    isInvalidated: () => Promise<boolean>;
  }) => {
    if (!await options.isCurrent()) {
      return EMPTY_SYNC_RESULT;
    }
    return { ...EMPTY_SYNC_RESULT, ...outcome };
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  handleIsCurrentMock.mockImplementation(() => Promise.resolve(true));
  isCalendarInvalidatedMock.mockImplementation(() => Promise.resolve(false));
  listRemoteEventsMock.mockImplementation(() => Promise.resolve([]));
  acquireMock.mockImplementation(() => Promise.resolve({
    acquired: true,
    handle: { isCurrent: handleIsCurrentMock, release: () => Promise.resolve() },
  }));
  resolveSyncProviderMock.mockImplementation(() => Promise.resolve({
    listRemoteEvents: listRemoteEventsMock,
  }));
  setOutcome({});
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("destination backoff on a wholly failed run", () => {
  it("backs off a run whose every add failed instead of clearing state", async () => {
    const { database, row } = createHarness({
      failureCount: 3,
      nextAttemptAt: new Date(START.getTime() - 1000),
    });
    setOutcome({ addFailed: 6, errors: ["push failed"] });

    await syncDestinationsForUser(USER_ID, config(database));

    expect(row.failureCount).toBe(4);
    expect(row.nextAttemptAt).toEqual(new Date(START.getTime() + FIVE_MINUTES_MS * 2 ** 3));
  });

  it("backs off a run whose every delete failed", async () => {
    const { database, row } = createHarness();
    setOutcome({ removeFailed: 18 });

    await syncDestinationsForUser(USER_ID, config(database));

    expect(row.failureCount).toBe(1);
    expect(row.nextAttemptAt).toEqual(new Date(START.getTime() + FIVE_MINUTES_MS));
  });

  it("clears backoff when the run made progress alongside failures", async () => {
    const { database, row } = createHarness({
      failureCount: 4,
      lastFailureAt: START,
      nextAttemptAt: new Date(START.getTime() - 1),
    });
    setOutcome({ added: 1, addFailed: 9 });

    await syncDestinationsForUser(USER_ID, config(database));

    expect(row).toEqual({ failureCount: 0, lastFailureAt: null, nextAttemptAt: null });
  });

  it("writes nothing for a healthy destination that had nothing to do", async () => {
    const { database, writes } = createHarness();

    await syncDestinationsForUser(USER_ID, config(database));

    expect(writes).toEqual([]);
  });
});

describe("repeated runs converge", () => {
  const runUntilEligible = async (
    database: unknown,
    row: CalendarRow,
    runs: number,
  ): Promise<{ failureCount: number; delayMs: number }[]> => {
    const observed: { failureCount: number; delayMs: number }[] = [];
    for (let index = 0; index < runs; index++) {
      if (row.nextAttemptAt) {
        vi.setSystemTime(row.nextAttemptAt);
      }
      const attemptedAt = new Date();
      await syncDestinationsForUser(USER_ID, config(database));
      observed.push({
        failureCount: row.failureCount,
        delayMs: (row.nextAttemptAt?.getTime() ?? attemptedAt.getTime())
          - attemptedAt.getTime(),
      });
    }
    return observed;
  };

  it("escalates monotonically and saturates at the six hour cap", async () => {
    const { database, row } = createHarness();
    setOutcome({ addFailed: 2 });

    const observed = await runUntilEligible(database, row, 12);

    expect(observed.map((entry) => entry.failureCount)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(observed.map((entry) => entry.delayMs)).toEqual([
      FIVE_MINUTES_MS,
      FIVE_MINUTES_MS * 2,
      FIVE_MINUTES_MS * 4,
      FIVE_MINUTES_MS * 8,
      FIVE_MINUTES_MS * 16,
      FIVE_MINUTES_MS * 32,
      FIVE_MINUTES_MS * 64,
      SIX_HOURS_MS,
      SIX_HOURS_MS,
      SIX_HOURS_MS,
      SIX_HOURS_MS,
      SIX_HOURS_MS,
    ]);
  });

  it("does not attempt the destination again before nextAttemptAt", async () => {
    const { database, row } = createHarness();
    setOutcome({ addFailed: 2 });

    await syncDestinationsForUser(USER_ID, config(database));
    expect(row.failureCount).toBe(1);

    syncCalendarMock.mockClear();
    vi.setSystemTime(new Date(START.getTime() + FIVE_MINUTES_MS - 1));
    await syncDestinationsForUser(USER_ID, config(database));

    expect(syncCalendarMock).not.toHaveBeenCalled();
    expect(row.failureCount).toBe(1);
  });

  it("retries exactly at nextAttemptAt", async () => {
    const { database, row } = createHarness();
    setOutcome({ addFailed: 2 });

    await syncDestinationsForUser(USER_ID, config(database));
    vi.setSystemTime(new Date(START.getTime() + FIVE_MINUTES_MS));
    await syncDestinationsForUser(USER_ID, config(database));

    expect(row.failureCount).toBe(2);
  });

  it("recovers to a clean state as soon as one operation succeeds", async () => {
    const { database, row } = createHarness();
    setOutcome({ addFailed: 2 });

    for (let index = 0; index < 5; index++) {
      vi.setSystemTime(row.nextAttemptAt ?? new Date());
      await syncDestinationsForUser(USER_ID, config(database));
    }
    expect(row.failureCount).toBe(5);

    setOutcome({ added: 2 });
    vi.setSystemTime(row.nextAttemptAt ?? new Date());
    await syncDestinationsForUser(USER_ID, config(database));

    expect(row).toEqual({ failureCount: 0, lastFailureAt: null, nextAttemptAt: null });
  });
});

describe("a single permanently failing event on an otherwise healthy destination", () => {
  it("escalates a fully mirrored destination to the maximum backoff", async () => {
    const { database, row } = createHarness();
    setOutcome({ added: 40, addFailed: 1 });
    await syncDestinationsForUser(USER_ID, config(database));
    expect(row.failureCount).toBe(0);

    setOutcome({ addFailed: 1 });
    for (let index = 0; index < 10; index++) {
      vi.setSystemTime(row.nextAttemptAt ?? new Date());
      await syncDestinationsForUser(USER_ID, config(database));
    }

    expect(row.failureCount).toBe(10);
    expect((row.nextAttemptAt?.getTime() ?? 0) - Date.now()).toBe(SIX_HOURS_MS);
  });
});

describe("runs that were superseded", () => {
  it("neither backs off nor clears backoff when the lock was lost", async () => {
    const { database, row, writes } = createHarness({
      failureCount: 3,
      nextAttemptAt: new Date(START.getTime() - 1),
    });
    setOutcome({ addFailed: 5 });
    handleIsCurrentMock.mockImplementation(() => Promise.resolve(false));

    await syncDestinationsForUser(USER_ID, config(database));

    expect(writes).toEqual([]);
    expect(row.failureCount).toBe(3);
  });

});

describe("a run that did no work because it was superseded", () => {
  const backedOff = () => createHarness({
    failureCount: 5,
    lastFailureAt: new Date(START.getTime() - SIX_HOURS_MS),
    nextAttemptAt: new Date(START.getTime() - 1),
  });

  it("keeps the accumulated backoff when the run hit its deadline", async () => {
    const { database, row } = backedOff();
    setOutcome({ added: 3 });

    await syncDestinationsForUser(USER_ID, {
      ...config(database),
      deadlineMs: START.getTime() - 1,
    });

    expect(row.failureCount).toBe(5);
    expect(row.nextAttemptAt).not.toBeNull();
  });

  it("keeps the accumulated backoff when the run was aborted mid-flight", async () => {
    const { database, row } = backedOff();
    const controller = new AbortController();
    setOutcome({ added: 3 });
    listRemoteEventsMock.mockImplementation(() => {
      controller.abort();
      return Promise.resolve([]);
    });

    await syncDestinationsForUser(USER_ID, {
      ...config(database),
      abortSignal: controller.signal,
    });

    expect(row.failureCount).toBe(5);
    expect(row.nextAttemptAt).not.toBeNull();
  });

  it("still converges when every other run is cut short by the deadline", async () => {
    const { database, row } = createHarness();
    setOutcome({ addFailed: 4 });
    const observed: number[] = [];

    for (let index = 0; index < 8; index++) {
      vi.setSystemTime(row.nextAttemptAt ?? new Date());
      const truncated = index % 2 === 1;
      await syncDestinationsForUser(USER_ID, {
        ...config(database),
        ...(truncated && { deadlineMs: Date.now() - 1 }),
      });
      observed.push(row.failureCount);
    }

    expect(observed.at(-1)).toBeGreaterThan(1);
  });
});

describe("thrown provider errors", () => {
  it("applies backoff once for a backoff-eligible error", async () => {
    const { database, row, writes } = createHarness({ failureCount: 1 });
    syncCalendarMock.mockImplementation(() => Promise.reject(new Error("Invalid credentials")));

    await syncDestinationsForUser(USER_ID, config(database));

    expect(writes).toHaveLength(1);
    expect(row.failureCount).toBe(2);
    expect(row.nextAttemptAt).toEqual(new Date(START.getTime() + FIVE_MINUTES_MS * 2));
  });

  it("does not double-apply backoff when the error arrives after a failed run", async () => {
    const { database, writes } = createHarness();
    syncCalendarMock.mockImplementation(() => Promise.reject(new Error("404 Not Found")));

    await syncDestinationsForUser(USER_ID, config(database));

    expect(writes).toHaveLength(1);
  });
});
