import { RequestTimeoutError } from "@keeper.sh/calendar";
import { GoogleCalendarApiError } from "@keeper.sh/calendar/google";
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
  capabilities: string[];
  failureCount: number;
  lastFailureAt: Date | null;
  nextAttemptAt: Date | null;
}

const createHarness = (initial: Partial<CalendarRow> = {}) => {
  const row: CalendarRow = {
    capabilities: ["pull", "push"],
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

  const pushableRows = () => {
    if (!row.capabilities.includes("push")) {
      return [];
    }
    return [attemptRow()];
  };

  const database = {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({ limit: () => Promise.resolve(pushableRows()) }),
        }),
        where: () => Promise.resolve(pushableRows().map(({ calendarId }) => ({ calendarId }))),
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

const createCallbacks = () => {
  const completions: { pushRemoved: boolean }[] = [];
  const failures: { backoffApplied: boolean; pushRemoved: boolean }[] = [];
  const skips: string[] = [];
  return {
    callbacks: {
      onCalendarComplete: (completion: { pushRemoved: boolean }) => {
        completions.push(completion);
      },
      onCalendarError: (failure: { backoffApplied: boolean; pushRemoved: boolean }) => {
        failures.push(failure);
      },
      onCalendarSkipped: (skip: { reason: string }) => {
        skips.push(skip.reason);
      },
    },
    completions,
    failures,
    skips,
  };
};

const config = (database: unknown) => ({
  destinationCalendarId: CALENDAR_ID,
  database: database as never,
  redis: {} as never,
  oauthConfig: {} as never,
  recordFirstSyncs: () => Promise.resolve([]),
  plan: "pro" as never,
});

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
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

const WRITER_ACCESS_BODY = JSON.stringify({
  error: {
    code: 403,
    errors: [{
      domain: "calendar",
      message: "You need to have writer access to this calendar.",
      reason: "requiredAccessLevel",
    }],
    message: "You need to have writer access to this calendar.",
  },
});

const RATE_LIMIT_BODY = JSON.stringify({
  error: { code: 403, errors: [{ reason: "rateLimitExceeded" }], message: "Rate Limit Exceeded" },
});

const refusedRun = (writeAccessDenied: boolean) => ({
  added: 0,
  addFailed: 3,
  conflictsResolved: 0,
  errors: Array.from({ length: 3 }, () => "You need to have writer access to this calendar."),
  removed: 0,
  removeFailed: 0,
  writeAccessDenied,
});

const scheduledDelayMs = (row: CalendarRow): number =>
  (row.nextAttemptAt?.getTime() ?? START.getTime()) - START.getTime();

describe("a destination whose pushes time out backs off", () => {
  it("advances backoff when a push times out", async () => {
    const { database, row } = createHarness();
    syncCalendarMock.mockImplementation(() => Promise.reject(new RequestTimeoutError(30_000)));

    await syncDestinationsForUser(USER_ID, config(database));

    expect(row.failureCount).toBe(1);
    expect(row.nextAttemptAt?.getTime()).toBeGreaterThan(START.getTime());
    expect(row.capabilities).toEqual(["pull", "push"]);
  });

  it("pushes the next attempt further out on each consecutive timeout", async () => {
    const { database, row } = createHarness();
    syncCalendarMock.mockImplementation(() => Promise.reject(new RequestTimeoutError(30_000)));
    const delays: number[] = [];

    for (let attempt = 0; attempt < 3; attempt++) {
      row.nextAttemptAt = null;
      await syncDestinationsForUser(USER_ID, config(database));
      delays.push(scheduledDelayMs(row));
    }

    expect(row.failureCount).toBe(3);
    expect(delays[1]).toBeGreaterThan(delays[0] ?? 0);
    expect(delays[2]).toBeGreaterThan(delays[1] ?? 0);
  });
});

describe("a calendar that refuses writes for missing writer access stops being a destination", () => {
  it("takes push away without backing off when Google throws the refusal", async () => {
    const { database, row, writes } = createHarness();
    const { callbacks, failures } = createCallbacks();
    syncCalendarMock.mockImplementation(
      () => Promise.reject(new GoogleCalendarApiError(403, WRITER_ACCESS_BODY)),
    );

    await syncDestinationsForUser(USER_ID, config(database), callbacks as never);

    expect(row.capabilities).toEqual(["pull"]);
    expect(row.failureCount).toBe(0);
    expect(row.nextAttemptAt).toBeNull();
    expect(writes).toEqual([{ capabilities: ["pull"] }]);
    expect(failures).toMatchObject([{ backoffApplied: false, pushRemoved: true }]);
  });

  it("takes push away without backing off when every write in the run is refused", async () => {
    const { database, row, writes } = createHarness();
    const { callbacks, completions } = createCallbacks();
    syncCalendarMock.mockImplementation(() => Promise.resolve(refusedRun(true)));

    await syncDestinationsForUser(USER_ID, config(database), callbacks as never);

    expect(row.capabilities).toEqual(["pull"]);
    expect(row.failureCount).toBe(0);
    expect(writes).toEqual([{ capabilities: ["pull"] }]);
    expect(completions).toMatchObject([{ pushRemoved: true }]);
  });

  it("no longer picks the calendar for push once push is taken away", async () => {
    const { database } = createHarness();
    const { callbacks, skips } = createCallbacks();
    syncCalendarMock.mockImplementation(
      () => Promise.reject(new GoogleCalendarApiError(403, WRITER_ACCESS_BODY)),
    );

    await syncDestinationsForUser(USER_ID, config(database), callbacks as never);
    await syncDestinationsForUser(USER_ID, config(database), callbacks as never);

    expect(syncCalendarMock).toHaveBeenCalledTimes(1);
    expect(skips).toEqual(["destination_not_pushable"]);
  });

  it("still backs off a run whose every write failed for another reason", async () => {
    const { database, row } = createHarness();
    const { callbacks, completions } = createCallbacks();
    syncCalendarMock.mockImplementation(() => Promise.resolve(refusedRun(false)));

    await syncDestinationsForUser(USER_ID, config(database), callbacks as never);

    expect(row.capabilities).toEqual(["pull", "push"]);
    expect(row.failureCount).toBe(1);
    expect(completions).toMatchObject([{ pushRemoved: false }]);
  });

  it("leaves push and backoff alone when Google rate limits with a 403", async () => {
    const { database, row, writes } = createHarness();
    syncCalendarMock.mockImplementation(
      () => Promise.reject(new GoogleCalendarApiError(403, RATE_LIMIT_BODY)),
    );

    await syncDestinationsForUser(USER_ID, config(database));

    expect(row.capabilities).toEqual(["pull", "push"]);
    expect(row.failureCount).toBe(0);
    expect(writes).toEqual([]);
  });
});
