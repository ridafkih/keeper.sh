import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const syncCalendarMock = vi.fn();
const listRemoteEventsMock = vi.fn(() => Promise.resolve([]));
const resolveSyncProviderMock = vi.fn();
const isCalendarInvalidatedMock = vi.fn(
  (_redis: unknown, _calendarId: string) => Promise.resolve(false),
);
const handleIsCurrentMock = vi.fn(() => Promise.resolve(true));
const mappedSourceCalendarIdsMock = vi.fn((): Promise<string[]> => Promise.resolve([]));
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
    getMappedSourceCalendarIds: () => mappedSourceCalendarIdsMock(),
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
const START = new Date("2026-11-01T04:30:00.000Z");
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

const setOutcome = (outcome: SyncOutcome) => {
  syncCalendarMock.mockImplementation(async (options: {
    isCurrent: () => Promise<boolean>;
  }) => {
    if (!await options.isCurrent()) {
      return EMPTY_SYNC_RESULT;
    }
    return { ...EMPTY_SYNC_RESULT, ...outcome };
  });
};

/*
 * A run whose reconciliation finds nothing to do returns all zeros after having
 * read both sides, and it consults isCurrent() before that read completes, not
 * after. Model the clock crossing the worker deadline while the run is in flight.
 */
const setInSyncRunThatOverrunsDeadline = (elapsedMs: number) => {
  syncCalendarMock.mockImplementation(async (options: {
    isCurrent: () => Promise<boolean>;
  }) => {
    if (!await options.isCurrent()) {
      return EMPTY_SYNC_RESULT;
    }
    vi.setSystemTime(new Date(Date.now() + elapsedMs));
    return EMPTY_SYNC_RESULT;
  });
};

/*
 * The provider is handed config.abortSignal, so a worker shutdown mid-flight
 * rejects the in-flight writes. syncCalendar counts those rejections as
 * addFailed and only then notices the supersession.
 */
const setRunAbortedMidOperations = (
  controller: AbortController,
  outcome: SyncOutcome,
) => {
  syncCalendarMock.mockImplementation(async (options: {
    isCurrent: () => Promise<boolean>;
  }) => {
    if (!await options.isCurrent()) {
      return EMPTY_SYNC_RESULT;
    }
    controller.abort();
    return { ...EMPTY_SYNC_RESULT, ...outcome };
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  handleIsCurrentMock.mockImplementation(() => Promise.resolve(true));
  isCalendarInvalidatedMock.mockImplementation(() => Promise.resolve(false));
  listRemoteEventsMock.mockImplementation(() => Promise.resolve([]));
  mappedSourceCalendarIdsMock.mockImplementation(() => Promise.resolve([]));
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

describe("a repaired destination that is already in sync", () => {
  it("clears the accumulated backoff on a run that finished past the deadline", async () => {
    const { database, row } = createHarness({
      failureCount: 5,
      lastFailureAt: new Date(START.getTime() - SIX_HOURS_MS),
      nextAttemptAt: new Date(START.getTime() - 1),
    });
    setInSyncRunThatOverrunsDeadline(30 * 1000);

    await syncDestinationsForUser(USER_ID, {
      ...config(database),
      deadlineMs: START.getTime() + 10 * 1000,
    });

    expect(row).toEqual({ failureCount: 0, lastFailureAt: null, nextAttemptAt: null });
  });

  it("does not stay pinned at the six hour step once it is healthy again", async () => {
    const { database, row } = createHarness({
      failureCount: 5,
      lastFailureAt: new Date(START.getTime() - SIX_HOURS_MS),
      nextAttemptAt: new Date(START.getTime() - 1),
    });
    setInSyncRunThatOverrunsDeadline(30 * 1000);

    for (let index = 0; index < 6; index++) {
      vi.setSystemTime(new Date(START.getTime() + index * 60 * 1000));
      await syncDestinationsForUser(USER_ID, {
        ...config(database),
        deadlineMs: Date.now() + 10 * 1000,
      });
    }
    expect(row.failureCount).toBe(0);

    const failedAt = new Date(Date.now());
    setOutcome({ addFailed: 1 });
    await syncDestinationsForUser(USER_ID, config(database));

    expect(row.nextAttemptAt).toEqual(new Date(failedAt.getTime() + FIVE_MINUTES_MS));
  });

  /*
   * The counter the healthy runs above cleared is the one the next failure
   * escalates from, so that failure is charged the first step rather than
   * resuming the series the destination accumulated before it was repaired.
   */
  it("charges the first backoff step on its next failure", async () => {
    const { database, row } = createHarness({
      failureCount: 5,
      lastFailureAt: new Date(START.getTime() - SIX_HOURS_MS),
      nextAttemptAt: new Date(START.getTime() - 1),
    });
    setInSyncRunThatOverrunsDeadline(30 * 1000);
    for (let index = 0; index < 6; index++) {
      vi.setSystemTime(new Date(START.getTime() + index * 60 * 1000));
      await syncDestinationsForUser(USER_ID, {
        ...config(database),
        deadlineMs: Date.now() + 10 * 1000,
      });
    }

    const failedAt = new Date(Date.now());
    setOutcome({ addFailed: 1 });
    await syncDestinationsForUser(USER_ID, config(database));

    expect(row.failureCount).toBe(1);
    expect((row.nextAttemptAt?.getTime() ?? 0) - failedAt.getTime())
      .toBe(FIVE_MINUTES_MS);
  });

  it("holds its backoff when the source set changed under the run", async () => {
    const { database, row, writes } = createHarness({
      failureCount: 2,
      nextAttemptAt: new Date(START.getTime() - 1),
    });
    mappedSourceCalendarIdsMock
      .mockImplementationOnce(() => Promise.resolve(["source-a"]))
      .mockImplementationOnce(() => Promise.resolve(["source-b"]));

    await syncDestinationsForUser(USER_ID, config(database));

    expect(writes).toEqual([]);
    expect(row.failureCount).toBe(2);
  });
});

describe("a healthy destination interrupted by a worker shutdown", () => {
  /*
   * Every destination provider rethrows once its signal is aborted rather than
   * reporting per-event failures, so a shutdown surfaces as a thrown AbortError
   * and must not be mistaken for a destination that is refusing writes.
   */
  it("leaves the backoff untouched when the abort surfaces as a thrown error", async () => {
    const { database, row, writes } = createHarness({
      failureCount: 2,
      nextAttemptAt: new Date(START.getTime() - 1),
    });
    const controller = new AbortController();
    syncCalendarMock.mockImplementation(() => {
      controller.abort();
      return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
    });

    await expect(syncDestinationsForUser(USER_ID, {
      ...config(database),
      abortSignal: controller.signal,
    })).rejects.toThrow("The operation was aborted.");

    expect(writes).toEqual([]);
    expect(row.failureCount).toBe(2);
  });

  it("does not accumulate a lockout across repeated shutdowns", async () => {
    const { database, row } = createHarness();

    for (let index = 0; index < 8; index++) {
      vi.setSystemTime(row.nextAttemptAt ?? new Date());
      const controller = new AbortController();
      setRunAbortedMidOperations(controller, { added: 0 });
      await syncDestinationsForUser(USER_ID, {
        ...config(database),
        abortSignal: controller.signal,
      });
    }

    expect(row.failureCount).toBe(0);
  });

  it("still escalates when the deadline expires after genuine push failures", async () => {
    const { database, row } = createHarness();
    syncCalendarMock.mockImplementation(async (options: {
      isCurrent: () => Promise<boolean>;
    }) => {
      if (!await options.isCurrent()) {
        return EMPTY_SYNC_RESULT;
      }
      vi.setSystemTime(new Date(Date.now() + 30 * 1000));
      return { ...EMPTY_SYNC_RESULT, addFailed: 4, errors: ["403 Forbidden"] };
    });

    await syncDestinationsForUser(USER_ID, {
      ...config(database),
      deadlineMs: START.getTime() + 10 * 1000,
    });

    expect(row.failureCount).toBe(1);
  });
});

describe("a thrown backoff-eligible error on a run this worker no longer owns", () => {
  it("does not write backoff after the lock was lost", async () => {
    const { database, writes } = createHarness({ failureCount: 0 });
    handleIsCurrentMock.mockImplementation(() => Promise.resolve(false));
    syncCalendarMock.mockImplementation(
      () => Promise.reject(new Error("Invalid credentials")),
    );

    await syncDestinationsForUser(USER_ID, config(database));

    expect(writes).toEqual([]);
  });

});

describe("eligibility of a wrapped provider error", () => {
  it("backs off when the wrapper repeats the cause message", async () => {
    const { database, row } = createHarness();
    syncCalendarMock.mockImplementation(() => Promise.reject(
      new Error("CalDAV create conflict recovery failed for event x: Invalid credentials"),
    ));

    await syncDestinationsForUser(USER_ID, config(database));

    expect(row.failureCount).toBe(1);
  });

  it("propagates a wrapper that carries the cause only on error.cause", async () => {
    const { database, writes } = createHarness();
    syncCalendarMock.mockImplementation(() => Promise.reject(
      new Error("push failed", { cause: new Error("Invalid credentials") }),
    ));

    await expect(syncDestinationsForUser(USER_ID, config(database)))
      .rejects.toThrow("push failed");
    expect(writes).toEqual([]);
  });
});

describe("backoff arithmetic at the edges", () => {
  it("stays at the six hour cap for an absurd failure count", async () => {
    const { database, row } = createHarness({
      failureCount: 1000,
      nextAttemptAt: new Date(START.getTime() - 1),
    });
    setOutcome({ removeFailed: 1 });

    await syncDestinationsForUser(USER_ID, config(database));

    expect(row.failureCount).toBe(1001);
    expect(row.nextAttemptAt).toEqual(new Date(START.getTime() + SIX_HOURS_MS));
    expect(Number.isFinite(row.nextAttemptAt?.getTime())).toBe(true);
  });

  it("treats a nextAttemptAt exactly at now as eligible", async () => {
    const { database, row } = createHarness({
      failureCount: 2,
      nextAttemptAt: new Date(START),
    });
    setOutcome({ addFailed: 1 });

    await syncDestinationsForUser(USER_ID, config(database));

    expect(row.failureCount).toBe(3);
  });

  it("writes nothing when the signal is already aborted before the loop", async () => {
    const { database, writes } = createHarness({
      failureCount: 4,
      nextAttemptAt: new Date(START.getTime() - 1),
    });
    setOutcome({ added: 5 });
    const controller = new AbortController();
    controller.abort();

    await syncDestinationsForUser(USER_ID, {
      ...config(database),
      abortSignal: controller.signal,
    });

    expect(writes).toEqual([]);
    expect(syncCalendarMock).not.toHaveBeenCalled();
  });
});

describe("verdict inputs that are easy to get wrong", () => {
  it("clears backoff for a superseded run whose only work was conflict resolution", async () => {
    const { database, row } = createHarness({
      failureCount: 3,
      nextAttemptAt: new Date(START.getTime() - 1),
    });
    const controller = new AbortController();
    setRunAbortedMidOperations(controller, { conflictsResolved: 2 });

    await syncDestinationsForUser(USER_ID, {
      ...config(database),
      abortSignal: controller.signal,
    });

    expect(row).toEqual({ failureCount: 0, lastFailureAt: null, nextAttemptAt: null });
  });

  it("does not reset twice when two consecutive healthy runs follow a backoff", async () => {
    const { database, writes } = createHarness({
      failureCount: 2,
      nextAttemptAt: new Date(START.getTime() - 1),
    });
    setOutcome({ added: 1 });

    await syncDestinationsForUser(USER_ID, config(database));
    await syncDestinationsForUser(USER_ID, config(database));

    expect(writes).toHaveLength(1);
  });

  it("escalates from the stored failure count, not from the count it just wrote", async () => {
    const { database, row, writes } = createHarness({ failureCount: 1 });
    setOutcome({ addFailed: 1, removeFailed: 1 });

    await syncDestinationsForUser(USER_ID, config(database));

    expect(writes).toHaveLength(1);
    expect(row.failureCount).toBe(2);
    expect(row.nextAttemptAt).toEqual(new Date(START.getTime() + FIVE_MINUTES_MS * 2));
  });
});
