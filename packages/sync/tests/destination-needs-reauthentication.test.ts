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

interface CalendarRow {
  needsReauthentication: boolean;
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
    needsReauthentication: false,
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
    needsReauthentication: row.needsReauthentication,
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
  recordFirstSyncs: () => Promise.resolve([]),
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

describe("a destination whose account needs the user to reconnect", () => {
  it("skips the push without touching the provider", async () => {
    const { database, writes } = createHarness({ needsReauthentication: true });
    const skips: { calendarId: string; reason: string }[] = [];

    await syncDestinationsForUser(USER_ID, config(database), {
      onCalendarSkipped: (skip) => { skips.push(skip); },
    });

    expect(resolveSyncProviderMock).not.toHaveBeenCalled();
    expect(syncCalendarMock).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
    expect(skips).toEqual([
      expect.objectContaining({ calendarId: CALENDAR_ID, reason: "account_needs_reauthentication" }),
    ]);
  });

  it("pushes again once the account is reconnected", async () => {
    const { database } = createHarness({ needsReauthentication: false });

    await syncDestinationsForUser(USER_ID, config(database));

    expect(resolveSyncProviderMock).toHaveBeenCalledTimes(1);
  });
});
