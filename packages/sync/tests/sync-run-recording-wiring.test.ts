import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const syncCalendarMock = vi.fn();
const readEventsMock = vi.fn();
const recordSyncRunMock = vi.fn((_database: unknown, _input: unknown) => Promise.resolve());
const recordSyncFailureMock = vi.fn((_database: unknown, _calendarId: string) => Promise.resolve());
const handleIsCurrentMock = vi.fn(() => Promise.resolve(true));
const pausedSourcesMock = vi.fn(() => Promise.resolve(new Set<string>()));

vi.mock("../src/sync-run-recording", () => ({
  recordSyncFailure: (database: unknown, calendarId: string) => recordSyncFailureMock(database, calendarId),
  recordSyncRun: (database: unknown, input: unknown) => recordSyncRunMock(database, input),
}));

vi.mock("@keeper.sh/calendar", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    createDatabaseFlush: () => () => Promise.resolve(),
    createGoogleUserRateLimiter: () => null,
    getEventMappingsForDestination: () => Promise.resolve([]),
    getEventsForCalendarsWithDiagnostics: (_database: unknown, calendarIds: string[]) => readEventsMock(calendarIds),
    getMappedSourceCalendarIds: () => Promise.resolve(["work", "school"]),
    getPausedSourceCalendarIds: () => pausedSourcesMock(),
    syncCalendar: (options: unknown) => syncCalendarMock(options),
    withSourceIngestLocks: (
      database: unknown,
      _ids: string[],
      run: (database: unknown) => Promise<unknown>,
    ) => run(database),
  };
});

vi.mock("../src/resolve-provider", () => ({
  resolveSyncProvider: () => Promise.resolve({ listRemoteEvents: () => Promise.resolve([]) }),
}));

vi.mock("../src/sync-lock", () => ({
  createMappingMutationLockId: (userId: string) => `mapping:${userId}`,
  createSyncLock: () => ({
    acquire: () => Promise.resolve({
      acquired: true,
      handle: { isCurrent: handleIsCurrentMock, release: () => Promise.resolve() },
    }),
  }),
}));

const { syncDestinationsForUser } = await import("../src/sync-user");

const USER_ID = "user-1";
const CALENDAR_ID = "family";
const DAY_MS = 24 * 60 * 60 * 1000;

interface CalendarRow {
  failureCount: number;
  lastFailureAt: Date | null;
  nextAttemptAt: Date | null;
}

const coverage = (id: string) => ({
  id,
  ingestFutureRange: "2_years",
  ingestHistoricRange: "3_months",
  ingestWindowEnd: new Date(Date.now() + 800 * DAY_MS),
  ingestWindowRecordedAt: new Date(),
  ingestWindowStart: new Date(Date.now() - 120 * DAY_MS),
});

const createHarness = (initial: Partial<CalendarRow> = {}) => {
  const row: CalendarRow = { failureCount: 0, lastFailureAt: null, nextAttemptAt: null, ...initial };
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
    select: (fields: Record<string, unknown>) => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({ limit: () => Promise.resolve([attemptRow()]) }),
        }),
        where: () => {
          if ("ingestWindowStart" in fields) {
            return Promise.resolve([coverage("work"), coverage("school")]);
          }
          if ("sourceCalendarId" in fields) {
            return Promise.resolve([{ sourceCalendarId: "work" }, { sourceCalendarId: "school" }]);
          }
          return Promise.resolve([{ calendarId: CALENDAR_ID }]);
        },
      }),
    }),
    update: () => ({
      set: (values: Partial<CalendarRow>) => ({
        where: () => {
          Object.assign(row, values);
          return Promise.resolve();
        },
      }),
    }),
  };
  return { database, row };
};

const config = (database: unknown, overrides: Record<string, unknown> = {}) => ({
  destinationCalendarId: CALENDAR_ID,
  database: database as never,
  redis: {} as never,
  oauthConfig: {} as never,
  plan: "pro" as never,
  ...overrides,
});

const WORK_TALLY = { work: { added: 3, failed: 0, removed: 1, updated: 2 } };

const syncResult = (overrides: Record<string, unknown> = {}) => ({
  added: 5,
  addFailed: 0,
  conflictsResolved: 0,
  errors: [],
  removed: 1,
  removeFailed: 0,
  sources: WORK_TALLY,
  ...overrides,
});

beforeEach(() => {
  handleIsCurrentMock.mockImplementation(() => Promise.resolve(true));
  pausedSourcesMock.mockImplementation(() => Promise.resolve(new Set<string>()));
  readEventsMock.mockImplementation(() => Promise.resolve({
    diagnostics: {
      overBudgetSourceEventStateIds: [],
      overBudgetSourceEventUids: [],
      sourceOutcomes: { work: { copied: 4, skipped: 1, skippedBy: {} } },
    },
    events: [],
  }));
  syncCalendarMock.mockImplementation(async (options: { isCurrent: () => Promise<boolean> }) => {
    await options.isCurrent();
    return syncResult();
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("a paused sync on the destination", () => {
  it("is left out of the local read, frozen in reconciliation and passed to the recording", async () => {
    pausedSourcesMock.mockImplementation(() => Promise.resolve(new Set(["school"])));
    const { database } = createHarness();

    await syncDestinationsForUser(USER_ID, config(database));

    expect(readEventsMock).toHaveBeenCalledWith(["work"]);
    const [[options]] = syncCalendarMock.mock.calls as [[{ reconciliationScope: { frozenSourceCalendarIds: Set<string> } }]];
    expect([...options.reconciliationScope.frozenSourceCalendarIds]).toEqual(["school"]);
    expect(recordSyncRunMock).toHaveBeenCalledWith(database, {
      destinationCalendarId: CALENDAR_ID,
      pausedSourceCalendarIds: new Set(["school"]),
      readSourceCalendarIds: new Set(["work"]),
      sourceOutcomes: { work: { copied: 4, skipped: 1, skippedBy: {} } },
      sourceTallies: WORK_TALLY,
    });
  });
});

describe("recording a completed attempt", () => {
  it("isn't done for a superseded attempt", async () => {
    const { database } = createHarness();

    await syncDestinationsForUser(USER_ID, config(database, { deadlineMs: Date.now() - 1 }));

    expect(syncCalendarMock).toHaveBeenCalled();
    expect(recordSyncRunMock).not.toHaveBeenCalled();
  });

  it("isn't done once the lease is lost", async () => {
    handleIsCurrentMock.mockImplementation(() => Promise.resolve(false));
    const { database } = createHarness();

    await syncDestinationsForUser(USER_ID, config(database));

    expect(recordSyncRunMock).not.toHaveBeenCalled();
  });

  it("fails without changing the verdict or the backoff, and is reported on its own", async () => {
    const outcomes = [];
    for (const recording of ["succeeds", "fails"]) {
      recordSyncRunMock.mockImplementation(() => {
        if (recording === "fails") {
          return Promise.reject(new Error("lock timeout"));
        }
        return Promise.resolve();
      });
      for (const result of [syncResult({ added: 0, addFailed: 4, removed: 0 }), syncResult()]) {
        syncCalendarMock.mockImplementation(() => Promise.resolve(result));
        const { database, row } = createHarness({ failureCount: 2, nextAttemptAt: new Date(Date.now() - 1000) });
        const onActivityRecordError = vi.fn();
        const outcome = await syncDestinationsForUser(USER_ID, config(database), { onActivityRecordError });
        outcomes.push({
          errors: outcome.errors,
          reported: onActivityRecordError.mock.calls.length,
          row: { failureCount: row.failureCount, backedOff: row.nextAttemptAt !== null },
        });
      }
    }

    const [failedRun, cleanRun, failedRunUnrecorded, cleanRunUnrecorded] = outcomes;
    expect(failedRun?.row).toEqual({ backedOff: true, failureCount: 3 });
    expect(cleanRun?.row).toEqual({ backedOff: false, failureCount: 0 });
    expect(failedRunUnrecorded?.row).toEqual(failedRun?.row);
    expect(cleanRunUnrecorded?.row).toEqual(cleanRun?.row);
    expect(cleanRun?.reported).toBe(0);
    expect(cleanRunUnrecorded?.reported).toBe(1);
    expect(cleanRunUnrecorded?.errors).toEqual(["Failed to record sync activity: lock timeout"]);
  });
});

describe("recording an attempt that threw", () => {
  it("marks the destination's pairs failing after the destination's own error is reported", async () => {
    syncCalendarMock.mockImplementation(() => Promise.reject(new Error("Google Calendar API 503: backend error")));
    const { database } = createHarness();
    const order: string[] = [];
    recordSyncFailureMock.mockImplementation(() => {
      order.push("recorded");
      return Promise.resolve();
    });

    await syncDestinationsForUser(USER_ID, config(database), {
      onCalendarError: () => order.push("reported"),
    });

    expect(recordSyncFailureMock).toHaveBeenCalledWith(database, CALENDAR_ID);
    expect(order).toEqual(["reported", "recorded"]);
    expect(recordSyncRunMock).not.toHaveBeenCalled();
  });

  it("isn't done once the lease is lost or the attempt ran out of time", async () => {
    syncCalendarMock.mockImplementation(() => Promise.reject(new Error("Google Calendar API 503: backend error")));

    handleIsCurrentMock.mockImplementation(() => Promise.resolve(false));
    await syncDestinationsForUser(USER_ID, config(createHarness().database));
    handleIsCurrentMock.mockImplementation(() => Promise.resolve(true));
    await syncDestinationsForUser(USER_ID, config(createHarness().database, { deadlineMs: Date.now() - 1 }));

    expect(recordSyncFailureMock).not.toHaveBeenCalled();
  });
});
