import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DeleteResult,
  EventMapping,
  MaterializedSyncableEvent,
  PushResult,
  RemoteEvent,
} from "@keeper.sh/calendar";

const resolveSyncProviderMock = vi.fn();
const isCalendarInvalidatedMock = vi.fn(
  (_redis: unknown, _calendarId: string) => Promise.resolve(false),
);
const handleIsCurrentMock = vi.fn(() => Promise.resolve(true));
const acquireMock = vi.fn();
const localEventsMock = vi.fn((): MaterializedSyncableEvent[] => []);
const flushedChanges: unknown[] = [];
const mappingsMock = vi.fn((): EventMapping[] => []);

const USER_ID = "user-1";
const CALENDAR_ID = "destination-1";
const SOURCE_ID = "source-1";

vi.mock("@keeper.sh/calendar", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    createDatabaseFlush: () => (changes: unknown) => {
      flushedChanges.push(changes);
      return Promise.resolve();
    },
    createGoogleUserRateLimiter: () => null,
    getEventMappingsForDestination: () => Promise.resolve(mappingsMock()),
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
      events: localEventsMock(),
    }),
    getMappedSourceCalendarIds: () => Promise.resolve([SOURCE_ID]),
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

const START = new Date("2026-03-08T00:30:00.000Z");

interface CalendarRow {
  failureCount: number;
  lastFailureAt: Date | null;
  nextAttemptAt: Date | null;
}

const makeEvent = (id: string, startTime: Date): MaterializedSyncableEvent => ({
  calendarId: SOURCE_ID,
  calendarName: "Source Calendar",
  calendarUrl: null,
  endTime: new Date(startTime.getTime() + 60 * 60 * 1000),
  id,
  sourceEventUid: `uid-${id}`,
  startTime,
  summary: `Event ${id}`,
});

const createHarness = (initial: Partial<CalendarRow> = {}) => {
  const row: CalendarRow = {
    failureCount: 0,
    lastFailureAt: null,
    nextAttemptAt: null,
    ...initial,
  };
  const writes: Partial<CalendarRow>[] = [];

  const sourceRow = {
    id: SOURCE_ID,
    ingestFutureRange: "12_months",
    ingestHistoricRange: "1_month",
    ingestWindowEnd: new Date("2100-01-01T00:00:00.000Z"),
    ingestWindowRecordedAt: START,
    ingestWindowStart: new Date("2000-01-01T00:00:00.000Z"),
  };

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
            return Promise.resolve([sourceRow]);
          }
          return Promise.resolve([{ calendarId: CALENDAR_ID }]);
        },
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

const config = (database: unknown, overrides: Record<string, unknown> = {}) => ({
  destinationCalendarId: CALENDAR_ID,
  database: database as never,
  redis: { exists: () => Promise.resolve(0) } as never,
  oauthConfig: {} as never,
  plan: "pro" as never,
  ...overrides,
});

const setProvider = (overrides: {
  deleteEvents?: (ids: string[]) => Promise<DeleteResult[]>;
  listRemoteEvents?: () => Promise<RemoteEvent[]>;
  pushEvents?: (events: MaterializedSyncableEvent[]) => Promise<PushResult[]>;
}) => {
  const provider = {
    deleteEvents: overrides.deleteEvents
      ?? ((ids: string[]) => Promise.resolve(ids.map(() => ({ success: true })))),
    listRemoteEvents: overrides.listRemoteEvents ?? (() => Promise.resolve([])),
    pushEvents: overrides.pushEvents
      ?? ((events: MaterializedSyncableEvent[]) =>
        Promise.resolve(events.map((_event, index) => ({
          remoteId: `remote-${index}`,
          success: true,
        })))),
  };
  resolveSyncProviderMock.mockImplementation(() => Promise.resolve(provider));
  return provider;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  flushedChanges.length = 0;
  handleIsCurrentMock.mockImplementation(() => Promise.resolve(true));
  isCalendarInvalidatedMock.mockImplementation(() => Promise.resolve(false));
  localEventsMock.mockImplementation(() => []);
  mappingsMock.mockImplementation(() => []);
  acquireMock.mockImplementation(() => Promise.resolve({
    acquired: true,
    handle: { isCurrent: handleIsCurrentMock, release: () => Promise.resolve() },
  }));
  setProvider({});
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("a destination run the deletion tombstone aborts", () => {
  const pendingAdds = () =>
    Array.from({ length: 60 }, (_value, index) =>
      makeEvent(`ev-${index}`, new Date(2026, 2, 10, 9, 0, 0)));

  it("pushes nothing, verdicts as inconclusive, and leaves the accumulated backoff intact", async () => {
    const previousNextAttemptAt = new Date(START.getTime() - 1);
    const { database, row, writes } = createHarness({
      failureCount: 4,
      lastFailureAt: new Date(START.getTime() - 60_000),
      nextAttemptAt: previousNextAttemptAt,
    });
    localEventsMock.mockImplementation(pendingAdds);
    let pushCalls = 0;
    let deleteCalls = 0;
    setProvider({
      deleteEvents: (ids) => {
        deleteCalls += 1;
        return Promise.resolve(ids.map(() => ({ success: true })));
      },
      pushEvents: (events) => {
        pushCalls += 1;
        return Promise.resolve(events.map((_event, index) => ({
          remoteId: `remote-${index}`,
          success: true,
        })));
      },
    });
    const syncEvents: Record<string, unknown>[] = [];

    const result = await syncDestinationsForUser(
      USER_ID,
      config(database, { redis: { exists: () => Promise.resolve(1) } }),
      {
        onSyncEvent: (event: Record<string, unknown>) => {
          syncEvents.push(event);
        },
      },
    );

    expect({ deleteCalls, pushCalls }).toEqual({ deleteCalls: 0, pushCalls: 0 });
    expect(flushedChanges).toEqual([]);
    expect(writes).toEqual([]);
    expect(row.failureCount).toBe(4);
    expect(row.nextAttemptAt).toEqual(previousNextAttemptAt);

    const [wideEvent] = syncEvents;
    expect(wideEvent?.["outcome"]).toBe("aborted");
    expect(wideEvent?.["aborted"]).toBe(true);
    expect(wideEvent?.["flushed"]).toBe(false);

    expect(result.aborted).toBe(true);
    expect(result.added).toBe(0);
  });
});
