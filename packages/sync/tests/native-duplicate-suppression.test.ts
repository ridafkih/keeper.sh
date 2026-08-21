import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeSyncOperations } from "@keeper.sh/calendar";
import { MS_PER_DAY } from "@keeper.sh/constants";
import type {
  BunSQLClient,
  DestinationEventReadDiagnostics,
  EventMapping,
  MaterializedSyncableEvent,
  SyncWindow,
} from "@keeper.sh/calendar";
import {
  createDestinationReconciliationWideEventFields,
  suppressNativeDuplicates,
} from "../src/sync-user";
import type { NativeDuplicateDestination } from "../src/sync-user";

const DESTINATION_CALENDAR_ID = "destination-1";
const SOURCE_CALENDAR_ID = "source-1";
const SHARED_UID = "invitation-uid@organizer.example";

const WINDOW: SyncWindow = {
  timeMax: new Date("2026-02-01T00:00:00.000Z"),
  timeMin: new Date("2026-01-01T00:00:00.000Z"),
};

const INGESTED_OVER_WINDOW: NativeDuplicateDestination = {
  calendarId: DESTINATION_CALENDAR_ID,
  ingestFutureRange: "2_years",
  ingestHistoricRange: "1_month",
  ingestWindowEnd: WINDOW.timeMax,
  ingestWindowRecordedAt: new Date("2026-01-01T00:05:00.000Z"),
  ingestWindowStart: WINDOW.timeMin,
  provider: "google",
};

const EVENT_READ_DIAGNOSTICS: DestinationEventReadDiagnostics = {
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

const createReconciliationFields = (suppressedNativeDuplicateCount: number) =>
  createDestinationReconciliationWideEventFields({
    authoritativeWindow: WINDOW,
    eventReadDiagnostics: EVENT_READ_DIAGNOSTICS,
    localReadDurationMs: 3,
    remoteReadDurationMs: 4,
    requestedWindow: WINDOW,
    sourceCalendarIdsAtLocalRead: [SOURCE_CALENDAR_ID],
    sourceCalendarIdsBeforeRemoteRead: [SOURCE_CALENDAR_ID],
    suppressedNativeDuplicateCount,
    verifiedSourceCalendarCount: 1,
  });

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

type NativeQueryResult = Promise<NativeEventStateRow[]> & {
  orderBy: () => NativeQueryResult;
};

/*
 * Drizzle hands the stub an opaque condition tree, so the calendar a read narrowed to is
 * recovered the only way the stub can recover it: the id named somewhere inside that tree.
 * A read pinned to a source calendar finds nothing here, exactly as it would in Postgres —
 * and a source's own copies match its materialized events exactly, so a fake that answered
 * them regardless would suppress the entire local snapshot without failing.
 */
const readRowsFor = (
  rowsByCalendarId: Record<string, NativeEventStateRow[]>,
  condition: unknown,
): NativeEventStateRow[] => {
  const visited = new WeakSet<object>();

  const walk = (node: unknown): NativeEventStateRow[] | null => {
    if (typeof node === "string") {
      return rowsByCalendarId[node] ?? null;
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

const createNativeDatabase = (
  rowsByCalendarId: Record<string, NativeEventStateRow[]>,
): BunSQLClient => {
  const chain = {
    from: () => chain,
    where: (condition: unknown): NativeQueryResult => {
      const results: NativeQueryResult = Object.assign(
        Promise.resolve(readRowsFor(rowsByCalendarId, condition)),
        { orderBy: (): NativeQueryResult => results },
      );
      return results;
    },
  };

  return { select: () => chain } as unknown as BunSQLClient;
};

const createLocalEvent = (
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

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createDestinationReconciliationWideEventFields", () => {
  it("reports how many mirrors the destination's own native copies suppressed", () => {
    const fields = createReconciliationFields(3);

    expect(fields["local_event_states.suppressed_native_duplicate_count"]).toBe(3);
  });

  it("still reports the field when nothing was suppressed", () => {
    const fields = createReconciliationFields(0);

    expect(fields).toHaveProperty("local_event_states.suppressed_native_duplicate_count", 0);
  });
});

describe("a destination whose native copy already covers a mirrored event", () => {
  beforeEach(() => {
    vi.setSystemTime(new Date("2026-01-01T01:00:00.000Z"));
  });

  const DUPLICATE_MAPPING: EventMapping = {
    calendarId: DESTINATION_CALENDAR_ID,
    deleteIdentifier: "delete-identifier-1",
    destinationEventUid: "destination-uid-1",
    endTime: new Date("2026-01-05T10:00:00.000Z"),
    eventStateId: "source-state-1",
    id: "mapping-1",
    sourceCalendarId: SOURCE_CALENDAR_ID,
    startTime: new Date("2026-01-05T09:00:00.000Z"),
    syncEventHash: "hash-1",
    syncEventId: "source-state-1",
  } as EventMapping;

  const SOLO_EVENT = createLocalEvent({
    endTime: new Date("2026-01-20T10:00:00.000Z"),
    eventStateId: "source-state-2",
    id: "source-state-2",
    sourceEventUid: "solo-uid@organizer.example",
    startTime: new Date("2026-01-20T09:00:00.000Z"),
  });

  const NATIVE_DUPLICATE_ROW: NativeEventStateRow = {
    endTime: new Date("2026-01-05T10:00:00.000Z"),
    exceptionDates: null,
    id: "native-state-1",
    isAllDay: false,
    recurrenceId: null,
    recurrenceRule: null,
    sourceEventUid: SHARED_UID,
    startTime: new Date("2026-01-05T09:00:00.000Z"),
    startTimeZone: null,
  };

  const filterAgainst = (rowsByCalendarId: Record<string, NativeEventStateRow[]>) =>
    suppressNativeDuplicates({
      database: createNativeDatabase(rowsByCalendarId),
      destination: INGESTED_OVER_WINDOW,
      events: [createLocalEvent({}), SOLO_EVENT],
      localReadWindow: WINDOW,
    });

  const readFilteredLocalEvents = () => filterAgainst({
    [DESTINATION_CALENDAR_ID]: [NATIVE_DUPLICATE_ROW],
  });

  it("drops the duplicate from the local snapshot and counts it", async () => {
    const filtered = await readFilteredLocalEvents();

    expect(filtered.events).toEqual([SOLO_EVENT]);
    expect(filtered.suppressedCount).toBe(1);
  });

  it("retires the mirror the suppressed event left behind and still adds the rest", async () => {
    const filtered = await readFilteredLocalEvents();

    const { operations } = computeSyncOperations(
      filtered.events,
      [DUPLICATE_MAPPING],
      [],
      {
        authoritativeSourceWindows: new Map([[SOURCE_CALENDAR_ID, WINDOW]]),
        authoritativeWindow: WINDOW,
        configuredSourceCalendarIds: new Set([SOURCE_CALENDAR_ID]),
        requestedWindow: WINDOW,
      },
    );

    expect(operations.filter((operation) => operation.type === "remove")).toEqual([{
      deleteId: DUPLICATE_MAPPING.deleteIdentifier,
      mappingId: DUPLICATE_MAPPING.id,
      startTime: DUPLICATE_MAPPING.startTime,
      type: "remove",
      uid: DUPLICATE_MAPPING.destinationEventUid,
    }]);
    expect(operations.filter((operation) => operation.type === "add")).toEqual([{
      event: SOLO_EVENT,
      type: "add",
    }]);
  });

  it("surfaces the suppressed count on the reconciliation wide event", async () => {
    const filtered = await readFilteredLocalEvents();

    const fields = createReconciliationFields(filtered.suppressedCount);

    expect(fields["local_event_states.suppressed_native_duplicate_count"]).toBe(1);
  });

  /*
   * The source calendar holds the very rows its events were materialized from, so an index
   * built over a source would match the whole local snapshot — and an empty snapshot leaves
   * reconciliation reading every mapping as an orphan. Only the destination's own copies
   * ever suppress.
   */
  it("suppresses nothing when only a source calendar holds the native copy", async () => {
    const filtered = await filterAgainst({
      [SOURCE_CALENDAR_ID]: [NATIVE_DUPLICATE_ROW],
    });

    expect(filtered.events).toEqual([createLocalEvent({}), SOLO_EVENT]);
    expect(filtered.suppressedCount).toBe(0);
  });
});

/*
 * A calendar's ingest ranges widen only for the destinations it feeds, so one that is only
 * ever a destination keeps the base month of history while its own sync range — and with it
 * every source feeding it — reaches back a year.
 */
describe("a destination whose ingest never reached as far back as its sources", () => {
  beforeEach(() => {
    vi.setSystemTime(new Date("2026-07-01T01:00:00.000Z"));
  });

  const YEAR_LONG_READ_WINDOW: SyncWindow = {
    timeMax: new Date("2027-01-01T00:00:00.000Z"),
    timeMin: new Date("2026-01-01T00:00:00.000Z"),
  };

  const INGESTED_FROM_JUNE: NativeDuplicateDestination = {
    calendarId: DESTINATION_CALENDAR_ID,
    ingestFutureRange: "2_years",
    ingestHistoricRange: "1_month",
    ingestWindowEnd: YEAR_LONG_READ_WINDOW.timeMax,
    ingestWindowRecordedAt: new Date("2026-07-01T00:00:00.000Z"),
    ingestWindowStart: new Date("2026-06-01T00:00:00.000Z"),
    provider: "caldav",
  };

  /*
   * A narrowing ingest window never prunes a recurring master, so the destination still
   * stores this one at slots its ingest stopped reading months ago — among them the
   * instance it has since detached and moved, whose override row was never fetched.
   */
  const STALE_NATIVE_MASTER: NativeEventStateRow = {
    endTime: new Date("2026-01-07T10:00:00.000Z"),
    exceptionDates: null,
    id: "native-state-1",
    isAllDay: false,
    recurrenceId: null,
    recurrenceRule: JSON.stringify({ frequency: "WEEKLY" }),
    sourceEventUid: SHARED_UID,
    startTime: new Date("2026-01-07T09:00:00.000Z"),
    startTimeZone: null,
  };

  const UNCOVERED_OCCURRENCE = createLocalEvent({
    endTime: new Date("2026-01-07T10:00:00.000Z"),
    eventStateId: "source-state-january",
    id: "source-state-january",
    startTime: new Date("2026-01-07T09:00:00.000Z"),
  });

  const COVERED_OCCURRENCE = createLocalEvent({
    endTime: new Date("2026-07-08T10:00:00.000Z"),
    eventStateId: "source-state-july",
    id: "source-state-july",
    startTime: new Date("2026-07-08T09:00:00.000Z"),
  });

  const filterAgainstStaleMaster = (destination: NativeDuplicateDestination) =>
    suppressNativeDuplicates({
      database: createNativeDatabase({ [DESTINATION_CALENDAR_ID]: [STALE_NATIVE_MASTER] }),
      destination,
      events: [UNCOVERED_OCCURRENCE, COVERED_OCCURRENCE],
      localReadWindow: YEAR_LONG_READ_WINDOW,
    });

  it("keeps the mirror of a slot its own ingest never verified", async () => {
    const filtered = await filterAgainstStaleMaster(INGESTED_FROM_JUNE);

    expect(filtered.events).toEqual([UNCOVERED_OCCURRENCE]);
    expect(filtered.suppressedCount).toBe(1);
  });

  it("suppresses nothing until an ingest has recorded a window at all", async () => {
    const filtered = await filterAgainstStaleMaster({
      ...INGESTED_FROM_JUNE,
      ingestWindowRecordedAt: null,
    });

    expect(filtered.events).toEqual([UNCOVERED_OCCURRENCE, COVERED_OCCURRENCE]);
    expect(filtered.suppressedCount).toBe(0);
  });

  it("suppresses nothing when its recorded ranges are not ranges it could have ingested", async () => {
    const filtered = await filterAgainstStaleMaster({
      ...INGESTED_FROM_JUNE,
      ingestHistoricRange: "1_decade",
    });

    expect(filtered.events).toEqual([UNCOVERED_OCCURRENCE, COVERED_OCCURRENCE]);
    expect(filtered.suppressedCount).toBe(0);
  });

  it("suppresses nothing when its coverage and the local read never overlap", async () => {
    const filtered = await filterAgainstStaleMaster({
      ...INGESTED_FROM_JUNE,
      ingestWindowEnd: new Date("2025-12-01T00:00:00.000Z"),
      ingestWindowStart: new Date("2025-11-01T00:00:00.000Z"),
    });

    expect(filtered.events).toEqual([UNCOVERED_OCCURRENCE, COVERED_OCCURRENCE]);
    expect(filtered.suppressedCount).toBe(0);
  });
});

/*
 * An OAuth calendar records coverage only on the full sync its sync-token rotation forces,
 * and a CalDAV one whenever the day-anchored window rolls, so a recorded window that has
 * stopped advancing is a destination whose ingest has stopped landing. Nothing prunes
 * event_states, so its rows outlive the native copies the user has deleted since — and
 * suppressing from them retires the mirror of a meeting that is now on neither calendar.
 * Each provider is held to its own cadence: the week an OAuth rotation is allowed to take
 * is a fortnight of missed day-rolls on the only destinations that store recurring masters,
 * where one frozen row goes on claiming every slot its rule expands to.
 */
describe("a destination whose ingest has stopped recording coverage", () => {
  const RECORDED_AT = new Date("2026-01-02T00:00:00.000Z");

  const wedgedSince = (provider: string): NativeDuplicateDestination => ({
    calendarId: DESTINATION_CALENDAR_ID,
    ingestFutureRange: "2_years",
    ingestHistoricRange: "1_month",
    ingestWindowEnd: new Date("2027-01-01T00:00:00.000Z"),
    ingestWindowRecordedAt: RECORDED_AT,
    ingestWindowStart: new Date("2025-12-01T00:00:00.000Z"),
    provider,
  });

  const wedgedFor = (days: number, milliseconds = 0): Date =>
    new Date(RECORDED_AT.getTime() + days * MS_PER_DAY + milliseconds);

  const READ_WINDOW: SyncWindow = {
    timeMax: new Date("2027-01-01T00:00:00.000Z"),
    timeMin: new Date("2026-01-01T00:00:00.000Z"),
  };

  const FROZEN_NATIVE_ROW: NativeEventStateRow = {
    endTime: new Date("2026-01-20T10:00:00.000Z"),
    exceptionDates: null,
    id: "native-state-1",
    isAllDay: false,
    recurrenceId: null,
    recurrenceRule: null,
    sourceEventUid: SHARED_UID,
    startTime: new Date("2026-01-20T09:00:00.000Z"),
    startTimeZone: null,
  };

  const INVITED_OCCURRENCE = createLocalEvent({
    endTime: new Date("2026-01-20T10:00:00.000Z"),
    eventStateId: "source-state-january",
    id: "source-state-january",
    startTime: new Date("2026-01-20T09:00:00.000Z"),
  });

  const filterAt = (provider: string, now: Date) => {
    vi.setSystemTime(now);
    return suppressNativeDuplicates({
      database: createNativeDatabase({ [DESTINATION_CALENDAR_ID]: [FROZEN_NATIVE_ROW] }),
      destination: wedgedSince(provider),
      events: [INVITED_OCCURRENCE],
      localReadWindow: READ_WINDOW,
    });
  };

  it("suppresses the duplicate while the recorded coverage is still current", async () => {
    const filtered = await filterAt("google", new Date("2026-01-03T00:00:00.000Z"));

    expect(filtered.events).toEqual([]);
    expect(filtered.suppressedCount).toBe(1);
  });

  it("keeps mirroring once the recorded coverage is older than any ingest that refreshes it", async () => {
    const filtered = await filterAt("google", new Date("2026-07-01T00:00:00.000Z"));

    expect(filtered.events).toEqual([INVITED_OCCURRENCE]);
    expect(filtered.suppressedCount).toBe(0);
  });

  it("still suppresses for an OAuth destination that has missed a single sync-token rotation", async () => {
    const filtered = await filterAt("google", wedgedFor(13));

    expect(filtered.events).toEqual([]);
    expect(filtered.suppressedCount).toBe(1);
  });

  it("keeps mirroring for an OAuth destination past two sync-token rotations", async () => {
    const current = await filterAt("google", wedgedFor(14));
    const stale = await filterAt("google", wedgedFor(14, 1));

    expect(current.suppressedCount).toBe(1);
    expect(stale.events).toEqual([INVITED_OCCURRENCE]);
    expect(stale.suppressedCount).toBe(0);
  });

  it("still suppresses for a CalDAV destination that has missed a single day-roll", async () => {
    const filtered = await filterAt("caldav", wedgedFor(2));

    expect(filtered.events).toEqual([]);
    expect(filtered.suppressedCount).toBe(1);
  });

  it("keeps mirroring for a CalDAV destination past two day-rolls", async () => {
    const filtered = await filterAt("caldav", wedgedFor(2, 1));

    expect(filtered.events).toEqual([INVITED_OCCURRENCE]);
    expect(filtered.suppressedCount).toBe(0);
  });

  /*
   * The week an OAuth rotation may take is thirteen day-rolls a CalDAV ingest has missed, and
   * its stored masters keep claiming every slot their rules expand to for the whole of it.
   */
  it("keeps mirroring for a CalDAV destination wedged for an OAuth rotation's worth of days", async () => {
    const filtered = await filterAt("caldav", wedgedFor(13));

    expect(filtered.events).toEqual([INVITED_OCCURRENCE]);
    expect(filtered.suppressedCount).toBe(0);
  });
});
