import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const syncCalendarMock = vi.fn();
const listRemoteEventsMock = vi.fn(() => Promise.resolve([]));
const resolveSyncProviderMock = vi.fn();
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
}));

const { syncDestinationsForUser } = await import("../src/sync-user");

const USER_ID = "user-1";
const CALENDAR_ID = "destination-1";
const START = new Date("2026-03-08T00:30:00.000Z");

interface CalendarRow {
  failureCount: number;
  lastFailureAt: Date | null;
  nextAttemptAt: Date | null;
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

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  handleIsCurrentMock.mockImplementation(() => Promise.resolve(true));
  listRemoteEventsMock.mockImplementation(() => Promise.resolve([]));
  acquireMock.mockImplementation(() => Promise.resolve({
    acquired: true,
    handle: { isCurrent: handleIsCurrentMock, release: () => Promise.resolve() },
  }));
  resolveSyncProviderMock.mockImplementation(() => Promise.resolve({
    listRemoteEvents: listRemoteEventsMock,
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("a superseded run reports its failure without claiming a backoff", () => {
  it("emits backoffApplied false when the lease was lost and a backoff-eligible error threw", async () => {
    const { database, row, writes } = createHarness({
      failureCount: 2,
      nextAttemptAt: new Date(START.getTime() - 1000),
    });
    const previousNextAttemptAt = row.nextAttemptAt;
    syncCalendarMock.mockImplementation(() => Promise.reject(new Error("Invalid credentials")));
    handleIsCurrentMock.mockImplementation(() => Promise.resolve(false));
    const onCalendarError = vi.fn();

    const result = await syncDestinationsForUser(
      USER_ID,
      config(database),
      { onCalendarError },
    );

    expect(result.errors.length).toBeGreaterThan(0);
    expect(writes).toEqual([]);
    expect(row.failureCount).toBe(2);
    expect(row.nextAttemptAt).toEqual(previousNextAttemptAt);
    expect(onCalendarError).toHaveBeenCalledTimes(1);
    expect(onCalendarError).toHaveBeenCalledWith(expect.objectContaining({
      backoffApplied: false,
      calendarId: CALENDAR_ID,
    }));
  });

  it("emits backoffApplied false when the lease was lost and a transient error threw", async () => {
    const { database, writes } = createHarness();
    syncCalendarMock.mockImplementation(() => Promise.reject(
      Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
    ));
    handleIsCurrentMock.mockImplementation(() => Promise.resolve(false));
    const onCalendarError = vi.fn();

    const result = await syncDestinationsForUser(
      USER_ID,
      config(database),
      { onCalendarError },
    );

    expect(result.errors.join(" ")).toContain("ECONNRESET");
    expect(writes).toEqual([]);
    expect(onCalendarError).toHaveBeenCalledWith(expect.objectContaining({
      backoffApplied: false,
    }));
  });
});
