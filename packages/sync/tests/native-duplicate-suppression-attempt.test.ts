import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DeleteResult,
  EventMapping,
  MaterializedSyncableEvent,
  PushResult,
} from "@keeper.sh/calendar";

const DESTINATION_CALENDAR_ID = "destination-1";
const SOURCE_CALENDAR_ID = "source-1";
const USER_ID = "user-1";
const SHARED_UID = "invitation-uid@organizer.example";
const SOLO_UID = "solo-uid@organizer.example";
const NOW = new Date("2026-01-01T00:00:00.000Z");

const createSourceEvent = (
  overrides: Partial<MaterializedSyncableEvent>,
): MaterializedSyncableEvent => ({
  calendarId: SOURCE_CALENDAR_ID,
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2026-01-05T10:00:00.000Z"),
  eventStateId: "source-state-1",
  id: "source-state-1",
  sourceEventUid: SHARED_UID,
  startTime: new Date("2026-01-05T09:00:00.000Z"),
  summary: "Design review",
  ...overrides,
} as MaterializedSyncableEvent);

const DUPLICATED_EVENT = createSourceEvent({});

const SOLO_EVENT = createSourceEvent({
  endTime: new Date("2026-01-20T10:00:00.000Z"),
  eventStateId: "source-state-2",
  id: "source-state-2",
  sourceEventUid: SOLO_UID,
  startTime: new Date("2026-01-20T09:00:00.000Z"),
  summary: "Solo review",
});

/*
 * The mirror an earlier run wrote for the duplicate, before the destination's own copy of
 * the invitation was ingested. Suppression drops the event, so reconciliation sees the
 * mapping orphaned and retires the mirror.
 */
const STALE_MIRROR_MAPPING = {
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier: "delete-identifier-1",
  destinationEventUid: "destination-uid-1",
  endTime: DUPLICATED_EVENT.endTime,
  eventStateId: DUPLICATED_EVENT.eventStateId,
  id: "mapping-1",
  sourceCalendarId: SOURCE_CALENDAR_ID,
  startTime: DUPLICATED_EVENT.startTime,
  syncEventHash: "hash-1",
  syncEventId: DUPLICATED_EVENT.id,
} as EventMapping;

const EVENT_READ_DIAGNOSTICS = {
  candidateEventStateCount: 2,
  emptyTimeRangeCount: 0,
  excludedBySyncPolicyCount: 0,
  invertedTimeRangeCount: 0,
  materializedEventCount: 2,
  missingSourceEventUidCount: 0,
  outsideReconciliationWindowCount: 0,
  overBudgetSourceEventStateIds: [],
  overBudgetSourceEventUids: [],
  syncableEventCount: 2,
};

const sourceEventsMock = vi.fn((): MaterializedSyncableEvent[] => []);
const existingMappingsMock = vi.fn((): EventMapping[] => []);
const pushEventsMock = vi.fn((events: MaterializedSyncableEvent[]): Promise<PushResult[]> =>
  Promise.resolve(events.map((event) => ({
    deleteId: `delete-${event.id}`,
    remoteId: `remote-${event.id}`,
    success: true,
  }))));
const deleteEventsMock = vi.fn((eventIds: string[]): Promise<DeleteResult[]> =>
  Promise.resolve(eventIds.map(() => ({ success: true }))));
const acquireMock = vi.fn();

vi.mock("@keeper.sh/calendar", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    createDatabaseFlush: () => () => Promise.resolve(),
    createGoogleUserRateLimiter: () => null,
    getEventMappingsForDestination: () => Promise.resolve(existingMappingsMock()),
    getEventsForCalendarsWithDiagnostics: () => Promise.resolve({
      diagnostics: EVENT_READ_DIAGNOSTICS,
      events: sourceEventsMock(),
    }),
    getMappedSourceCalendarIds: () => Promise.resolve([SOURCE_CALENDAR_ID]),
    withSourceIngestLocks: (
      database: unknown,
      _ids: string[],
      run: (database: unknown) => Promise<unknown>,
    ) => run(database),
  };
});

vi.mock("../src/resolve-provider", () => ({
  resolveSyncProvider: () => Promise.resolve({
    deleteEvents: (eventIds: string[]) => deleteEventsMock(eventIds),
    listRemoteEvents: () => Promise.resolve([]),
    pushEvents: (events: MaterializedSyncableEvent[]) => pushEventsMock(events),
  }),
}));

vi.mock("../src/sync-lock", () => ({
  createMappingMutationLockId: (userId: string) => `mapping:${userId}`,
  createSyncLock: () => ({
    acquire: (calendarId: string, signal: unknown, lockId: string) =>
      acquireMock(calendarId, signal, lockId),
  }),
  isCalendarInvalidated: () => Promise.resolve(false),
}));

const { syncDestinationsForUser } = await import("../src/sync-user");

const INGEST_COVERAGE = {
  ingestFutureRange: "2_years",
  ingestHistoricRange: "1_month",
  ingestWindowEnd: new Date("2027-06-01T00:00:00.000Z"),
  ingestWindowRecordedAt: NOW,
  ingestWindowStart: new Date("2025-11-01T00:00:00.000Z"),
};

const DESTINATION_ATTEMPT_ROW = {
  accountId: "account-1",
  calendarId: DESTINATION_CALENDAR_ID,
  failureCount: 0,
  ...INGEST_COVERAGE,
  nextAttemptAt: null,
  provider: "google",
  syncFutureRange: "12_months",
  syncHistoricRange: "1_month",
  userId: USER_ID,
};

const SOURCE_COVERAGE_ROW = { id: SOURCE_CALENDAR_ID, ...INGEST_COVERAGE };

interface NativeEventStateRow {
  endTime: Date;
  exceptionDates: string | null;
  id: string;
  isAllDay: boolean | null;
  recurrenceId: Date | null;
  recurrenceRule: string | null;
  sourceEventUid: string | null;
  startTime: Date;
  startTimeZone: string | null;
}

const NATIVE_DUPLICATE_ROW: NativeEventStateRow = {
  endTime: DUPLICATED_EVENT.endTime,
  exceptionDates: null,
  id: "native-state-1",
  isAllDay: false,
  recurrenceId: null,
  recurrenceRule: null,
  sourceEventUid: SHARED_UID,
  startTime: DUPLICATED_EVENT.startTime,
  startTimeZone: null,
};

/*
 * Drizzle hands the stub an opaque condition tree, so the calendar a read narrowed to is
 * recovered the only way the stub can recover it: the id named somewhere inside that tree.
 * A native read pinned to any other calendar finds nothing here, exactly as it would in
 * Postgres — which is what keeps this fixture honest about WHICH calendar's own copies the
 * attempt suppresses against.
 */
const readNativeRowsFor = (
  nativeRowsByCalendarId: Record<string, NativeEventStateRow[]>,
  condition: unknown,
): NativeEventStateRow[] => {
  const visited = new WeakSet<object>();

  const walk = (node: unknown): NativeEventStateRow[] | null => {
    if (typeof node === "string") {
      return nativeRowsByCalendarId[node] ?? null;
    }
    if (typeof node !== "object" || node === null || visited.has(node)) {
      return null;
    }
    visited.add(node);
    for (const value of Object.values(node)) {
      const rows = walk(value);
      if (rows) {
        return rows;
      }
    }
    return null;
  };

  return walk(condition) ?? [];
};

/*
 * One stub serves every read the attempt makes, so the columns each query asks for are what
 * tells them apart — including the destination's own event_states read, which is the whole
 * point of driving the attempt rather than the suppression helper on its own.
 */
const resolveRows = (
  columns: Record<string, unknown>,
  nativeRowsByCalendarId: Record<string, NativeEventStateRow[]>,
  condition: unknown,
): unknown[] => {
  if ("sourceEventUid" in columns) {
    return readNativeRowsFor(nativeRowsByCalendarId, condition);
  }
  if ("sourceCalendarId" in columns) {
    return [{ sourceCalendarId: SOURCE_CALENDAR_ID }];
  }
  if ("accountId" in columns) {
    return [DESTINATION_ATTEMPT_ROW];
  }
  if ("ingestWindowStart" in columns) {
    return [SOURCE_COVERAGE_ROW];
  }
  return [{ calendarId: DESTINATION_CALENDAR_ID }];
};

const createDatabase = (nativeRowsByCalendarId: Record<string, NativeEventStateRow[]>) => ({
  select: (columns: Record<string, unknown>) => {
    const chain = {
      from: () => chain,
      innerJoin: () => chain,
      where: (condition: unknown) => {
        const rows = resolveRows(columns, nativeRowsByCalendarId, condition);
        return Object.assign(Promise.resolve(rows), { limit: () => Promise.resolve(rows) });
      },
    };
    return chain;
  },
  update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
});

interface AttemptFixture {
  existingMappings?: EventMapping[];
  nativeRowsByCalendarId: Record<string, NativeEventStateRow[]>;
}

const runAttempt = async (fixture: AttemptFixture) => {
  const syncEvents: Record<string, unknown>[] = [];
  existingMappingsMock.mockImplementation(() => fixture.existingMappings ?? []);

  await syncDestinationsForUser(USER_ID, {
    database: createDatabase(fixture.nativeRowsByCalendarId) as never,
    destinationCalendarId: DESTINATION_CALENDAR_ID,
    oauthConfig: {} as never,
    plan: "pro" as never,
    redis: {} as never,
  }, { onSyncEvent: (event) => syncEvents.push(event) });

  return {
    deleted: deleteEventsMock.mock.calls.flatMap(([eventIds]) => eventIds),
    pushed: pushEventsMock.mock.calls.flatMap(([events]) => events.map((event) => event.id)),
    syncEvent: syncEvents.at(-1) ?? {},
  };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  sourceEventsMock.mockImplementation(() => [DUPLICATED_EVENT, SOLO_EVENT]);
  acquireMock.mockImplementation(() => Promise.resolve({
    acquired: true,
    handle: { isCurrent: () => Promise.resolve(true), release: () => Promise.resolve() },
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("a destination attempt over a calendar already holding its own copy", () => {
  const HELD_BY_DESTINATION = { [DESTINATION_CALENDAR_ID]: [NATIVE_DUPLICATE_ROW] };

  it("never pushes the mirror its native copy makes redundant", async () => {
    const attempt = await runAttempt({ nativeRowsByCalendarId: HELD_BY_DESTINATION });

    expect(attempt.pushed).toEqual([SOLO_EVENT.id]);
    expect(attempt.deleted).toEqual([]);
  });

  it("retires the mirror an earlier run left on that slot, without pushing it again", async () => {
    const attempt = await runAttempt({
      existingMappings: [STALE_MIRROR_MAPPING],
      nativeRowsByCalendarId: HELD_BY_DESTINATION,
    });

    expect(attempt.deleted).toEqual([STALE_MIRROR_MAPPING.deleteIdentifier]);
    expect(attempt.pushed).toEqual([SOLO_EVENT.id]);
  });

  it("reports the suppression on the attempt's wide event", async () => {
    const attempt = await runAttempt({ nativeRowsByCalendarId: HELD_BY_DESTINATION });

    expect(attempt.syncEvent["local_event_states.suppressed_native_duplicate_count"]).toBe(1);
    expect(attempt.syncEvent["local_events.count"]).toBe(1);
  });

  it("mirrors every source event when the destination holds no native copy", async () => {
    const attempt = await runAttempt({ nativeRowsByCalendarId: {} });

    expect(attempt.pushed).toEqual([DUPLICATED_EVENT.id, SOLO_EVENT.id]);
    expect(attempt.syncEvent["local_event_states.suppressed_native_duplicate_count"]).toBe(0);
  });
});

/*
 * Every source event is by definition a native copy on the calendar it came from, so a read
 * pinned to anything but the destination matches the whole local snapshot: the attempt would
 * push nothing and reconciliation would read every mapping it holds as an orphan, wiping the
 * destination's mirrors. The suppression index is only ever the destination's own copies.
 */
describe("a destination attempt whose sources hold the only native copies", () => {
  const HELD_BY_SOURCE = { [SOURCE_CALENDAR_ID]: [NATIVE_DUPLICATE_ROW] };

  it("mirrors a source event the destination itself has no copy of", async () => {
    const attempt = await runAttempt({ nativeRowsByCalendarId: HELD_BY_SOURCE });

    expect(attempt.pushed).toEqual([DUPLICATED_EVENT.id, SOLO_EVENT.id]);
    expect(attempt.syncEvent["local_event_states.suppressed_native_duplicate_count"]).toBe(0);
  });

  it("leaves the local snapshot whole rather than emptying it into orphaned mappings", async () => {
    const attempt = await runAttempt({ nativeRowsByCalendarId: HELD_BY_SOURCE });

    expect(attempt.syncEvent["local_events.count"]).toBe(2);
  });
});
