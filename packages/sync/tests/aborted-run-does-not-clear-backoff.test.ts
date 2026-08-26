import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DeleteResult,
  EventMapping,
  MaterializedSyncableEvent,
  PushResult,
  RemoteEvent,
} from "@keeper.sh/calendar";

const USER_ID = "user-1";
const CALENDAR_ID = "destination-1";
const SOURCE_ID = "source-1";

const START = new Date("2026-03-08T00:30:00.000Z");

interface CalendarRow {
  failureCount: number;
  lastFailureAt: Date | null;
  nextAttemptAt: Date | null;
}

interface HarnessOptions {
  calendarInvalidated?: boolean;
  deleteEvents?: (ids: string[]) => Promise<DeleteResult[]>;
  deletionTombstonePresent?: boolean;
  handleIsCurrent?: () => Promise<boolean>;
  listRemoteEvents?: () => Promise<RemoteEvent[]>;
  localEvents?: () => MaterializedSyncableEvent[];
  mappings?: () => EventMapping[];
  pushEvents?: (events: MaterializedSyncableEvent[]) => Promise<PushResult[]>;
  row?: Partial<CalendarRow>;
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

const createHarness = (options: HarnessOptions = {}) => {
  const row: CalendarRow = {
    failureCount: 0,
    lastFailureAt: null,
    nextAttemptAt: null,
    ...options.row,
  };
  const writes: Partial<CalendarRow>[] = [];
  const flushedChanges: unknown[] = [];

  const localEvents = options.localEvents ?? ((): MaterializedSyncableEvent[] => []);
  const mappings = options.mappings ?? ((): EventMapping[] => []);
  const handleIsCurrent = options.handleIsCurrent ?? (() => Promise.resolve(true));
  const calendarInvalidated = options.calendarInvalidated ?? false;

  const provider = {
    deleteEvents: options.deleteEvents
      ?? ((ids: string[]) => Promise.resolve(ids.map(() => ({ success: true })))),
    listRemoteEvents: options.listRemoteEvents ?? (() => Promise.resolve([])),
    pushEvents: options.pushEvents
      ?? ((events: MaterializedSyncableEvent[]) =>
        Promise.resolve(events.map((_event, index) => ({
          remoteId: `remote-${index}`,
          success: true,
        })))),
  };

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

  const deletionTombstoneCount = Number(options.deletionTombstonePresent ?? false);

  const config = {
    destinationCalendarId: CALENDAR_ID,
    database: database as never,
    redis: {
      exists: () => Promise.resolve(deletionTombstoneCount),
    } as never,
    oauthConfig: {} as never,
    plan: "pro" as never,
  };

  const syncDestinations = async (
    callbacks: { onSyncEvent: (event: Record<string, unknown>) => void },
  ) => {
    vi.resetModules();

    vi.doMock("@keeper.sh/calendar", async (importOriginal) => {
      const original = await importOriginal<Record<string, unknown>>();
      return {
        ...original,
        createDatabaseFlush: () => (changes: unknown) => {
          flushedChanges.push(changes);
          return Promise.resolve();
        },
        createGoogleUserRateLimiter: () => null,
        getEventMappingsForDestination: () => Promise.resolve(mappings()),
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
          events: localEvents(),
        }),
        getMappedSourceCalendarIds: () => Promise.resolve([SOURCE_ID]),
        withSourceIngestLocks: (
          database_: unknown,
          _ids: string[],
          run: (database_: unknown) => Promise<unknown>,
        ) => run(database_),
      };
    });

    vi.doMock("../src/resolve-provider", () => ({
      resolveSyncProvider: () => Promise.resolve(provider),
    }));

    vi.doMock("../src/sync-lock", () => ({
      createMappingMutationLockId: (userId: string) => `mapping:${userId}`,
      createSyncLock: () => ({
        acquire: () => Promise.resolve({
          acquired: true,
          handle: { isCurrent: handleIsCurrent, release: () => Promise.resolve() },
        }),
      }),
      isCalendarInvalidated: () => Promise.resolve(calendarInvalidated),
    }));

    const { syncDestinationsForUser } = await import("../src/sync-user");

    vi.useFakeTimers();
    vi.setSystemTime(START);
    try {
      return await syncDestinationsForUser(USER_ID, config, callbacks);
    } finally {
      vi.useRealTimers();
    }
  };

  return { flushedChanges, provider, row, syncDestinations, writes };
};

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
});

describe("a destination run the deletion tombstone aborts", () => {
  const pendingAdds = () =>
    Array.from({ length: 60 }, (_value, index) =>
      makeEvent(`ev-${index}`, new Date(2026, 2, 10, 9, 0, 0)));

  it("pushes nothing, verdicts as inconclusive, and leaves the accumulated backoff intact", async () => {
    const previousNextAttemptAt = new Date(START.getTime() - 1);
    let pushCalls = 0;
    let deleteCalls = 0;
    const { flushedChanges, row, syncDestinations, writes } = createHarness({
      deleteEvents: (ids) => {
        deleteCalls += 1;
        return Promise.resolve(ids.map(() => ({ success: true })));
      },
      deletionTombstonePresent: true,
      localEvents: pendingAdds,
      pushEvents: (events) => {
        pushCalls += 1;
        return Promise.resolve(events.map((_event, index) => ({
          remoteId: `remote-${index}`,
          success: true,
        })));
      },
      row: {
        failureCount: 4,
        lastFailureAt: new Date(START.getTime() - 60_000),
        nextAttemptAt: previousNextAttemptAt,
      },
    });
    const syncEvents: Record<string, unknown>[] = [];

    const result = await syncDestinations({
      onSyncEvent: (event: Record<string, unknown>) => {
        syncEvents.push(event);
      },
    });

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
  }, 30_000);
});
