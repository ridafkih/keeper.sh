import { isDatabaseError } from "@keeper.sh/database";
import { DrizzleQueryError } from "drizzle-orm/errors";
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

const MAPPING_UPSERT_SQL =
  'insert into "event_mappings" ("calendar_id", "external_event_id", "uid", "content_hash") '
  + "values ($1, $2, $3, $4) on conflict (\"calendar_id\", \"uid\") do update set "
  + '"external_event_id" = excluded."external_event_id"';

const createDatabaseWriteFailure = (): DrizzleQueryError =>
  new DrizzleQueryError(
    MAPPING_UPSERT_SQL,
    ["calendar-1", "abc-123", "uid-1@fastmail.com", "0f1a"],
    Object.assign(new Error("deadlock detected"), {
      name: "PostgresError",
      code: "ERR_POSTGRES_SERVER_ERROR",
      errno: "40P01",
    }),
  );

const createOAuthServiceUnavailableFailure = (): Error =>
  Object.assign(
    new Error('Token refresh failed (503): {"error":"service_unavailable"}'),
    {
      name: "GoogleOAuthRefreshError",
      oauthReauthRequired: false,
      oauthRetriable: true,
      status: 503,
    },
  );

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

describe("our own infrastructure failing does not back the destination off", () => {
  it("leaves retry state untouched when a database write fails mid-push", async () => {
    const previousNextAttemptAt = new Date(START.getTime() - 1000);
    const { database, row, writes } = createHarness({
      failureCount: 2,
      nextAttemptAt: previousNextAttemptAt,
    });
    const failure = createDatabaseWriteFailure();
    expect(isDatabaseError(failure)).toBe(true);
    syncCalendarMock.mockImplementation(() => Promise.reject(failure));

    const result = await syncDestinationsForUser(USER_ID, config(database));

    expect(writes).toEqual([]);
    expect(row.failureCount).toBe(2);
    expect(row.nextAttemptAt).toEqual(previousNextAttemptAt);
    expect(result.errors).toHaveLength(1);
  });

  it("leaves retry state untouched when our auth infrastructure answers 503", async () => {
    const { database, row, writes } = createHarness();
    syncCalendarMock.mockImplementation(
      () => Promise.reject(createOAuthServiceUnavailableFailure()),
    );

    const result = await syncDestinationsForUser(USER_ID, config(database));

    expect(writes).toEqual([]);
    expect(row.failureCount).toBe(0);
    expect(row.nextAttemptAt).toBeNull();
    expect(result.errors).toHaveLength(1);
  });

  it("keeps the destination eligible across repeated database failures", async () => {
    const { database, row } = createHarness();
    syncCalendarMock.mockImplementation(() => Promise.reject(createDatabaseWriteFailure()));

    for (let attempt = 0; attempt < 8; attempt++) {
      await syncDestinationsForUser(USER_ID, config(database));
    }

    expect(row.failureCount).toBe(0);
    expect(row.nextAttemptAt).toBeNull();
  });
});
