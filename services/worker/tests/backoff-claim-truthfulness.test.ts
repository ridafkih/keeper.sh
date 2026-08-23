import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface WideEvent {
  fields: Record<string, unknown>;
  values: Record<string, unknown>;
}

interface CalendarRow {
  failureCount: number;
  lastFailureAt: Date | null;
  nextAttemptAt: Date | null;
}

const emitted: WideEvent[] = [];
let current: WideEvent = { fields: {}, values: {} };

const syncCalendarMock = vi.fn();
const listRemoteEventsMock = vi.fn(() => Promise.resolve([]));
const resolveSyncProviderMock = vi.fn();
const handleIsCurrentMock = vi.fn(() => Promise.resolve(true));
const acquireMock = vi.fn();

const USER_ID = "user-1";
const CALENDAR_ID = "calendar-1";

const destinationRow: CalendarRow = {
  failureCount: 0,
  lastFailureAt: null,
  nextAttemptAt: null,
};
const calendarWrites: Partial<CalendarRow>[] = [];

const attemptRow = () => ({
  accountId: "account-1",
  calendarId: CALENDAR_ID,
  failureCount: destinationRow.failureCount,
  nextAttemptAt: destinationRow.nextAttemptAt,
  provider: "google",
  syncFutureRange: "12_months",
  syncHistoricRange: "1_month",
  userId: USER_ID,
});

const fakeDatabase = {
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
        calendarWrites.push({ ...values });
        Object.assign(destinationRow, values);
        return Promise.resolve();
      },
    }),
  }),
};

vi.mock("../src/utils/logging", () => ({
  context: (run: () => Promise<unknown>) => run(),
  destroy: () => null,
  widelog: {
    append: () => null,
    error: () => null,
    errorFields: (_error: unknown, fields: Record<string, unknown>) => {
      current.fields = { ...current.fields, ...fields };
    },
    errors: () => null,
    flush: () => {
      emitted.push(current);
      current = { fields: {}, values: {} };
    },
    set: (key: string, value: unknown) => {
      current.values[key] = value;
      return { sticky: () => null };
    },
    time: {
      measure: <TResult>(_key: string, run: () => Promise<TResult>) => run(),
    },
  },
}));

vi.mock("../src/env", () => ({
  default: {
    ENCRYPTION_KEY: "0".repeat(64),
    GOOGLE_CLIENT_ID: "google-client",
    GOOGLE_CLIENT_SECRET: "google-secret",
    MICROSOFT_CLIENT_ID: "microsoft-client",
    MICROSOFT_CLIENT_SECRET: "microsoft-secret",
  },
}));

vi.mock("../src/context", () => ({
  database: fakeDatabase,
  refreshLockRedis: {},
  refreshLockStore: {},
  shutdownConnections: () => null,
}));

vi.mock("@keeper.sh/broadcast", () => ({
  createBroadcastService: () => ({ emit: () => null }),
}));

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

vi.mock("../../../packages/sync/src/resolve-provider", () => ({
  resolveSyncProvider: (options: unknown) => resolveSyncProviderMock(options),
}));

vi.mock("../../../packages/sync/src/sync-lock", () => ({
  createMappingMutationLockId: (userId: string) => `mapping:${userId}`,
  createSyncLock: () => ({
    acquire: (calendarId: string, signal: unknown, lockId: string) =>
      acquireMock(calendarId, signal, lockId),
  }),
  isCalendarInvalidated: () => Promise.resolve(false),
  SyncLockRenewalError: class SyncLockRenewalError extends Error {},
}));

const { processJob } = await import("../src/processor");

const createJob = () => ({
  data: {
    calendarId: CALENDAR_ID,
    correlationId: "correlation-1",
    plan: "pro",
    userId: USER_ID,
  },
  id: "job-1",
  name: "push-sync",
  timestamp: Date.now(),
  updateProgress: () => null,
});

const runProcessJob = (): Promise<unknown> =>
  (processJob as unknown as (job: unknown) => Promise<unknown>)(createJob());

const firstEvent = (): WideEvent => {
  const [event] = emitted;
  if (!event) {
    throw new Error("no wide event was emitted");
  }
  return event;
};

beforeEach(() => {
  emitted.length = 0;
  current = { fields: {}, values: {} };
  calendarWrites.length = 0;
  destinationRow.failureCount = 0;
  destinationRow.lastFailureAt = null;
  destinationRow.nextAttemptAt = null;
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
  vi.clearAllMocks();
});

describe("a backoff is only claimed when one was written", () => {
  it("reports the error without claiming a backoff when the verdict was inconclusive", async () => {
    syncCalendarMock.mockImplementation(() => Promise.reject(
      Object.assign(new Error("The operation was aborted"), { name: "AbortError" }),
    ));

    await runProcessJob();

    expect(calendarWrites).toEqual([]);
    expect(destinationRow.nextAttemptAt).toBeNull();

    const event = firstEvent();
    expect(event.values.outcome).toBe("error");
    expect(event.values["retry.backoff_applied"]).toBe(false);
  });

  it("reports the error without claiming a backoff when a transient provider blip threw", async () => {
    syncCalendarMock.mockImplementation(() => Promise.reject(
      Object.assign(new Error("Service Unavailable"), { statusCode: 503 }),
    ));

    await runProcessJob();

    expect(calendarWrites).toEqual([]);

    const event = firstEvent();
    expect(event.values.outcome).toBe("error");
    expect(event.values["retry.backoff_applied"]).toBe(false);
  });

  it("claims a backoff when the destination's next attempt was actually advanced", async () => {
    syncCalendarMock.mockImplementation(() => Promise.reject(
      new Error("Invalid credentials"),
    ));

    await runProcessJob();

    expect(calendarWrites.length).toBe(1);
    expect(destinationRow.nextAttemptAt).not.toBeNull();

    const event = firstEvent();
    expect(event.values.outcome).toBe("error");
    expect(event.values["retry.backoff_applied"]).toBe(true);
  });
});
