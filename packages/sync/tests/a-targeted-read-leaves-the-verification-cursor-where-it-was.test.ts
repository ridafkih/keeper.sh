import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  EventMapping,
  EventPresence,
  EventVerificationTarget,
  ListRemoteEventsOptions,
  MaterializedSyncableEvent,
  RemoteEvent,
} from "@keeper.sh/calendar";
import {
  createEditableEventContentHash,
  createEditableEventContentSnapshot,
  createSyncEventContentHash,
} from "../../calendar/src/core/events/content-hash";

const USER_ID = "user-1";
const SOURCE_CALENDAR_ID = "source-1";
const DESTINATION_CALENDAR_ID = "destination-1";
const NOW = new Date("2026-08-05T09:00:00.000Z");

const REQUESTED_WINDOW = {
  timeMax: new Date("2026-09-01T00:00:00.000Z"),
  timeMin: new Date("2026-08-01T00:00:00.000Z"),
};

const SOURCE_COVERAGE_ROW = {
  id: SOURCE_CALENDAR_ID,
  ingestFutureRange: "12_months",
  ingestHistoricRange: "1_month",
  ingestWindowEnd: new Date("2027-08-05T00:00:00.000Z"),
  ingestWindowRecordedAt: NOW,
  ingestWindowStart: new Date("2026-07-05T00:00:00.000Z"),
};

const VERIFICATION_BUDGET = 200;
const LIVE_MAPPING_COUNT = 260;
const DELETED_DELETE_IDENTIFIER = "id-zz-deleted";
const FIRST_CYCLE_CURSOR = "id-live-199";

const createStart = (index: number): Date =>
  new Date(REQUESTED_WINDOW.timeMin.getTime() + (index % 27 + 1) * 60 * 60 * 1000);

const withHalfHour = (start: Date): Date => new Date(start.getTime() + 30 * 60 * 1000);

const createLocalEvent = (suffix: string, index: number): MaterializedSyncableEvent => ({
  calendarId: SOURCE_CALENDAR_ID,
  calendarName: "Source",
  calendarUrl: null,
  endTime: withHalfHour(createStart(index)),
  eventStateId: `event-state-${suffix}`,
  id: `sync-event-${suffix}`,
  sourceEventUid: `source-uid-${suffix}`,
  startTime: createStart(index),
  summary: `Event ${suffix}`,
});

const createMapping = (suffix: string, deleteIdentifier: string, index: number): EventMapping => ({
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier,
  destinationEventUid: deleteIdentifier,
  endTime: withHalfHour(createStart(index)),
  eventStateId: `event-state-${suffix}`,
  id: `mapping-${suffix}`,
  sourceCalendarId: SOURCE_CALENDAR_ID,
  startTime: createStart(index),
  syncEventHash: createSyncEventContentHash(createLocalEvent(suffix, index)),
  syncEventId: `sync-event-${suffix}`,
});

const createLiveRemoteEvent = (
  mapping: EventMapping,
  localEvent: MaterializedSyncableEvent,
): RemoteEvent => ({
  deleteId: mapping.deleteIdentifier,
  editableAvailability: "busy",
  editableContent: createEditableEventContentSnapshot(localEvent),
  editableContentHash: createEditableEventContentHash(localEvent),
  endTime: mapping.endTime,
  isKeeperEvent: true,
  startTime: mapping.startTime,
  summary: localEvent.summary,
  uid: mapping.destinationEventUid,
});

const liveSuffixes = Array.from(
  { length: LIVE_MAPPING_COUNT },
  (unused, index) => `live-${String(index).padStart(3, "0")}`,
);

const liveMappings = liveSuffixes.map((suffix, index) => createMapping(suffix, `id-${suffix}`, index));

const deletedMapping = createMapping("zz-deleted", DELETED_DELETE_IDENTIFIER, 7);

const allMappings = [...liveMappings, deletedMapping];

const allLocalEvents = [
  ...liveSuffixes.map((suffix, index) => createLocalEvent(suffix, index)),
  createLocalEvent("zz-deleted", 7),
];

const localEventsById = new Map(allLocalEvents.map((localEvent) => [localEvent.id, localEvent]));

const requireLocalEvent = (mapping: EventMapping): MaterializedSyncableEvent => {
  const localEvent = localEventsById.get(mapping.syncEventId as string);
  if (!localEvent) {
    throw new Error(`No local event for mapping ${mapping.id}`);
  }
  return localEvent;
};

const liveRemoteEventsByDeleteId = new Map(liveMappings.map((mapping) => [
  mapping.deleteIdentifier,
  createLiveRemoteEvent(mapping, requireLocalEvent(mapping)),
]));

const answerVerification = (target: EventVerificationTarget): EventPresence => {
  const liveEvent = liveRemoteEventsByDeleteId.get(target.deleteId);
  if (!liveEvent) {
    return { identifier: target.deleteId, status: "absent" };
  }
  return { event: liveEvent, identifier: target.deleteId, status: "present" };
};

const createProviderDouble = () => {
  const verifiedIds: string[] = [];
  const readByIdCalls: string[][] = [];
  return {
    getRemoteEventsByIds: (deleteIds: string[]): Promise<RemoteEvent[]> => {
      readByIdCalls.push([...deleteIds]);
      const found: RemoteEvent[] = [];
      for (const deleteId of deleteIds) {
        const remoteEvent = liveRemoteEventsByDeleteId.get(deleteId);
        if (remoteEvent) {
          found.push(remoteEvent);
        }
      }
      return Promise.resolve(found);
    },
    listRemoteEvents: (_options: ListRemoteEventsOptions): Promise<RemoteEvent[]> =>
      Promise.resolve([]),
    readByIdCalls,
    verifiedIds,
    verifyEventsExist: (targets: EventVerificationTarget[]): Promise<EventPresence[]> => {
      verifiedIds.push(...targets.map((target) => target.deleteId));
      return Promise.resolve(targets.map((target) => answerVerification(target)));
    },
  };
};

const syncCalendarMock = vi.fn((_options: unknown) => Promise.resolve({
  added: 0,
  addFailed: 0,
  conflictsResolved: 0,
  errors: [],
  removed: 0,
  removeFailed: 0,
  updated: 0,
}));
const resolveSyncProviderMock = vi.fn();
const acquireMock = vi.fn();
const handleIsCurrentMock = vi.fn(() => Promise.resolve(true));

let mappedSourceCalendarIds: string[] = [SOURCE_CALENDAR_ID];
let mappingsForDestination: EventMapping[] = [];
let localEventsForRead: MaterializedSyncableEvent[] = [];

const EVENT_READ_DIAGNOSTICS = {
  candidateEventStateCount: 0,
  emptyTimeRangeCount: 0,
  excludedBySyncPolicyCount: 0,
  invertedTimeRangeCount: 0,
  materializedEventCount: 0,
  missingSourceEventUidCount: 0,
  outsideReconciliationWindowCount: 0,
  overBudgetSourceEventStateIds: [],
  overBudgetSourceEventUids: [],
  syncableEventCount: 0,
};

vi.mock("@keeper.sh/calendar", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    createDatabaseFlush: () => () => Promise.resolve(),
    createGoogleUserRateLimiter: () => null,
    getEventMappingsForDestination: () => Promise.resolve(mappingsForDestination),
    getEventsForCalendarsWithDiagnostics: () => Promise.resolve({
      diagnostics: EVENT_READ_DIAGNOSTICS,
      events: localEventsForRead,
    }),
    getMappedSourceCalendarIds: () => Promise.resolve(mappedSourceCalendarIds),
    syncCalendar: (options: unknown) => syncCalendarMock(options as never),
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
  isCalendarInvalidated: () => Promise.resolve(false),
}));

const { readDestinationRemoteEvents, syncDestinationsForUser } = await import("../src/sync-user");

interface VerificationReport {
  nextVerificationCursor?: string | null;
  unverifiedMappingIds: ReadonlySet<string>;
}

interface CycleRead {
  authoritativeMappingIds: ReadonlySet<string> | null;
  remoteEvents: RemoteEvent[];
  verification?: VerificationReport;
}

interface CycleContext {
  existingMappings: EventMapping[];
  localEvents: MaterializedSyncableEvent[];
  provider: ReturnType<typeof createProviderDouble>;
  requestedWindow: typeof REQUESTED_WINDOW;
  verificationCursor?: string | null;
}

const readCycle = readDestinationRemoteEvents as unknown as (
  context: CycleContext,
) => Promise<CycleRead>;

const runCycle = async (
  existingMappings: EventMapping[],
  localEvents: MaterializedSyncableEvent[],
  verificationCursor: string | null,
) => {
  const provider = createProviderDouble();
  const read = await readCycle({
    existingMappings,
    localEvents,
    provider,
    requestedWindow: REQUESTED_WINDOW,
    verificationCursor,
  });
  return { provider, read };
};

const requireVerification = (read: CycleRead): VerificationReport => {
  if (!read.verification) {
    throw new Error("The read returned no verification report at all");
  }
  return read.verification;
};

interface CalendarRow {
  failureCount: number;
  lastFailureAt: Date | null;
  nextAttemptAt: Date | null;
  verificationCursor: string | null;
}

const createSeamHarness = (storedCursor: string | null) => {
  const row: CalendarRow = {
    failureCount: 0,
    lastFailureAt: null,
    nextAttemptAt: null,
    verificationCursor: storedCursor,
  };
  const writes: Record<string, unknown>[] = [];

  const attemptRow = () => ({
    accountId: "account-1",
    calendarId: DESTINATION_CALENDAR_ID,
    failureCount: row.failureCount,
    nextAttemptAt: row.nextAttemptAt,
    provider: "google",
    syncFutureRange: "12_months",
    syncHistoricRange: "1_month",
    userId: USER_ID,
    verificationCursor: row.verificationCursor,
  });

  const database = {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({ limit: () => Promise.resolve([attemptRow()]) }),
        }),
        where: () => Promise.resolve([SOURCE_COVERAGE_ROW]),
      }),
    }),
    update: () => ({
      set: (values: Partial<CalendarRow>) => ({
        where: () => {
          writes.push(values as Record<string, unknown>);
          Object.assign(row, values);
          return Promise.resolve();
        },
      }),
    }),
  };

  return { database, row, writes };
};

const cursorWrites = (writes: Record<string, unknown>[]): Record<string, unknown>[] =>
  writes.filter((values) => "verificationCursor" in values);

const config = (database: unknown) => ({
  database: database as never,
  destinationCalendarId: DESTINATION_CALENDAR_ID,
  oauthConfig: {} as never,
  plan: "pro" as never,
  redis: {} as never,
});

const runSeamCycle = async (
  storedCursor: string | null,
  sourceCalendarIds: string[],
  localEvents: MaterializedSyncableEvent[],
  existingMappings: EventMapping[] = allMappings,
) => {
  const harness = createSeamHarness(storedCursor);
  const provider = createProviderDouble();
  resolveSyncProviderMock.mockImplementation(() => Promise.resolve(provider));
  mappedSourceCalendarIds = sourceCalendarIds;
  mappingsForDestination = existingMappings;
  localEventsForRead = localEvents;

  await syncDestinationsForUser(USER_ID, config(harness.database));

  return { ...harness, provider };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  handleIsCurrentMock.mockImplementation(() => Promise.resolve(true));
  acquireMock.mockImplementation(() => Promise.resolve({
    acquired: true,
    handle: { isCurrent: handleIsCurrentMock, release: () => Promise.resolve() },
  }));
  mappedSourceCalendarIds = [SOURCE_CALENDAR_ID];
  mappingsForDestination = allMappings;
  localEventsForRead = [];
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("what a targeted by-id read says about the rotation position", () => {
  it("reports a resume position from the windowed cycle that paid for it", async () => {
    const { provider, read } = await runCycle(allMappings, allLocalEvents, null);

    expect(provider.verifiedIds).toHaveLength(VERIFICATION_BUDGET);
    expect(requireVerification(read).nextVerificationCursor).toBe(FIRST_CYCLE_CURSOR);
  });

  it("carries no cursor field at all when the push plan named a handful of identifiers", async () => {
    const localEvents = allLocalEvents.slice(0, 5);

    const { provider, read } = await runCycle(allMappings, localEvents, FIRST_CYCLE_CURSOR);

    expect(provider.readByIdCalls).toHaveLength(1);
    expect(provider.verifiedIds).toEqual([]);
    expect("nextVerificationCursor" in requireVerification(read)).toBe(false);
  });

  it("carries no cursor field when the push plan named nothing at all", async () => {
    const { provider, read } = await runCycle(allMappings, [], FIRST_CYCLE_CURSOR);

    expect(provider.readByIdCalls).toEqual([[]]);
    expect("nextVerificationCursor" in requireVerification(read)).toBe(false);
  });

  it("carries no cursor field on the supersede branch's empty read", async () => {
    const { read } = await runCycle([], [], FIRST_CYCLE_CURSOR);

    expect(read.authoritativeMappingIds).not.toBeNull();
    expect("nextVerificationCursor" in requireVerification(read)).toBe(false);
  });
});

describe("the persistence seam", () => {
  it("issues no cursor write for a targeted cycle that named a handful of identifiers", async () => {
    const { row, writes } = await runSeamCycle(
      FIRST_CYCLE_CURSOR,
      [SOURCE_CALENDAR_ID],
      allLocalEvents.slice(0, 5),
    );

    expect(cursorWrites(writes)).toEqual([]);
    expect(row.verificationCursor).toBe(FIRST_CYCLE_CURSOR);
  });

  it("issues no cursor write for a cycle with no source authority and so no plan", async () => {
    const { row, writes } = await runSeamCycle(FIRST_CYCLE_CURSOR, [], []);

    expect(cursorWrites(writes)).toEqual([]);
    expect(row.verificationCursor).toBe(FIRST_CYCLE_CURSOR);
  });

  it("still persists the position a windowed cycle reports", async () => {
    const { row, writes } = await runSeamCycle(null, [SOURCE_CALENDAR_ID], allLocalEvents);

    expect(cursorWrites(writes)).toEqual([{ verificationCursor: FIRST_CYCLE_CURSOR }]);
    expect(row.verificationCursor).toBe(FIRST_CYCLE_CURSOR);
  });

  it("still persists an explicit null when the rotation wrapped", async () => {
    const withinBudget = allMappings.slice(0, VERIFICATION_BUDGET);

    const { row, writes } = await runSeamCycle(
      FIRST_CYCLE_CURSOR,
      [SOURCE_CALENDAR_ID],
      allLocalEvents,
      withinBudget,
    );

    expect(cursorWrites(writes)).toEqual([{ verificationCursor: null }]);
    expect(row.verificationCursor).toBeNull();
  });
});

describe("the mirror the recipient deleted, three cycles in", () => {
  it("is reached by the windowed cycle that follows a targeted one", async () => {
    const firstCycle = await runCycle(allMappings, allLocalEvents, null);
    expect(requireVerification(firstCycle.read).nextVerificationCursor).toBe(FIRST_CYCLE_CURSOR);

    const seam = await runSeamCycle(
      FIRST_CYCLE_CURSOR,
      [SOURCE_CALENDAR_ID],
      allLocalEvents.slice(0, 5),
    );

    const thirdCycle = await runCycle(allMappings, allLocalEvents, seam.row.verificationCursor);

    expect(thirdCycle.provider.verifiedIds).toContain(DELETED_DELETE_IDENTIFIER);
    expect(thirdCycle.provider.verifiedIds).not.toContain("id-live-000");
  });

  it("stays in the unverified set forever while the cursor keeps being cleared", async () => {
    const seam = await runSeamCycle(FIRST_CYCLE_CURSOR, [], []);

    const thirdCycle = await runCycle(allMappings, allLocalEvents, seam.row.verificationCursor);

    expect(thirdCycle.provider.verifiedIds).toContain(DELETED_DELETE_IDENTIFIER);
  });
});
