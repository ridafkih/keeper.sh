import { describe, expect, it } from "vitest";
import { computeSyncOperations } from "@keeper.sh/calendar";
import type {
  EventMapping,
  EventPresence,
  ListRemoteEventsOptions,
  MaterializedSyncableEvent,
  RemoteEvent,
  SyncOperation,
} from "@keeper.sh/calendar";
import {
  createDestinationReconciliationScope,
  createDestinationReconciliationWideEventFields,
  readDestinationRemoteEvents,
} from "../src/sync-user";

const SOURCE_CALENDAR_ID = "source-1";
const DESTINATION_CALENDAR_ID = "destination-1";

const REQUESTED_WINDOW = {
  timeMax: new Date("2026-08-01T00:00:00.000Z"),
  timeMin: new Date("2026-07-01T00:00:00.000Z"),
};

const EVENT_READ_DIAGNOSTICS = {
  candidateEventStateCount: 0,
  emptyTimeRangeCount: 0,
  excludedBySyncPolicyCount: 0,
  invertedTimeRangeCount: 0,
  materializedEventCount: 0,
  missingSourceEventUidCount: 0,
  outsideReconciliationWindowCount: 0,
  overBudgetSourceEventStateIds: [] as string[],
  overBudgetSourceEventUids: [] as string[],
  syncableEventCount: 0,
};

const VERIFICATION_BUDGET = 200;

/*
 * One run's worth of mappings the windowed listing did not turn up, deliberately wider than
 * the budget: the tail past PRESENT + ABSENT + UNKNOWN is never asked about at all.
 */
const PRESENT_COUNT = 40;
const ABSENT_COUNT = 140;
const UNKNOWN_COUNT = 20;
const MAPPING_COUNT = 260;
const UNVERIFIED_COUNT = MAPPING_COUNT - PRESENT_COUNT - ABSENT_COUNT;

const createStartTime = (index: number): Date =>
  new Date(Date.UTC(2026, 6, 2, 10, 0, 0) + index * 60 * 60 * 1000);

const createEndTime = (index: number): Date =>
  new Date(createStartTime(index).getTime() + 30 * 60 * 1000);

/* Zero padded so the budget's lexicographic ordering is the index ordering. */
const createDeleteIdentifier = (index: number): string =>
  `destination-event-${String(index).padStart(3, "0")}`;

const createDestinationEventUid = (index: number): string =>
  `destination-uid-${String(index).padStart(3, "0")}`;

const createLocalEvent = (index: number): MaterializedSyncableEvent => ({
  calendarId: SOURCE_CALENDAR_ID,
  calendarName: "Source",
  calendarUrl: null,
  endTime: createEndTime(index),
  eventStateId: `event-state-${index}`,
  id: `sync-event-${index}`,
  sourceEventUid: `source-uid-${index}`,
  startTime: createStartTime(index),
  summary: `Event ${index}`,
});

const createMapping = (index: number): EventMapping => ({
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier: createDeleteIdentifier(index),
  destinationEventUid: createDestinationEventUid(index),
  endTime: createEndTime(index),
  eventStateId: `event-state-${index}`,
  id: `mapping-${String(index).padStart(3, "0")}`,
  sourceCalendarId: SOURCE_CALENDAR_ID,
  startTime: createStartTime(index),
  syncEventHash: "hash-recorded-at-last-push",
  syncEventId: `sync-event-${index}`,
});

const createRemoteEvent = (index: number): RemoteEvent => ({
  deleteId: createDeleteIdentifier(index),
  endTime: createEndTime(index),
  isKeeperEvent: true,
  startTime: createStartTime(index),
  uid: createDestinationEventUid(index),
});

const indexesFrom = (start: number, count: number): number[] =>
  Array.from({ length: count }, (unused, offset) => start + offset);

const PRESENT_INDEXES = indexesFrom(0, PRESENT_COUNT);
const ABSENT_INDEXES = indexesFrom(PRESENT_COUNT, ABSENT_COUNT);
const UNKNOWN_INDEXES = indexesFrom(PRESENT_COUNT + ABSENT_COUNT, UNKNOWN_COUNT);
const BEYOND_BUDGET_INDEXES = indexesFrom(VERIFICATION_BUDGET, MAPPING_COUNT - VERIFICATION_BUDGET);
const UNVERIFIED_INDEXES = [...UNKNOWN_INDEXES, ...BEYOND_BUDGET_INDEXES];

const localEvents = indexesFrom(0, MAPPING_COUNT).map((index) => createLocalEvent(index));
const existingMappings = indexesFrom(0, MAPPING_COUNT).map((index) => createMapping(index));

const createPresence = (index: number): EventPresence => {
  if (PRESENT_INDEXES.includes(index)) {
    return {
      event: createRemoteEvent(index),
      identifier: createDeleteIdentifier(index),
      status: "present",
    };
  }
  if (ABSENT_INDEXES.includes(index)) {
    return { identifier: createDeleteIdentifier(index), status: "absent" };
  }
  return { identifier: createDeleteIdentifier(index), status: "unknown" };
};

const indexOfDeleteIdentifier = (deleteIdentifier: string): number =>
  Number(deleteIdentifier.replace("destination-event-", ""));

/*
 * The windowed listing turns up none of these mirrors - the false-absence case a by-id
 * verification exists to settle.
 */
const createProviderDouble = () => {
  const listedWindows: ListRemoteEventsOptions[] = [];
  const verifiedIds: string[] = [];
  return {
    listedWindows,
    listRemoteEvents: (options: ListRemoteEventsOptions): Promise<RemoteEvent[]> => {
      listedWindows.push(options);
      return Promise.resolve([]);
    },
    verifiedIds,
    verifyEventsExist: (deleteIds: string[]): Promise<EventPresence[]> => {
      verifiedIds.push(...deleteIds);
      return Promise.resolve(
        deleteIds.map((deleteId) => createPresence(indexOfDeleteIdentifier(deleteId))),
      );
    },
  };
};

interface DestinationVerificationReport {
  unverifiedCount: number;
  unverifiedMappingIds: ReadonlySet<string>;
  verifiedAbsentCount: number;
  verifiedPresentCount: number;
}

interface VerifiedDestinationRemoteRead {
  authoritativeMappingIds: ReadonlySet<string> | null;
  remoteEvents: RemoteEvent[];
  verification?: DestinationVerificationReport;
}

const readDestination = async (): Promise<VerifiedDestinationRemoteRead> => {
  const provider = createProviderDouble();
  const read = await readDestinationRemoteEvents({
    existingMappings,
    localEvents,
    provider,
    requestedWindow: REQUESTED_WINDOW,
  });
  expect(provider.listedWindows).toEqual([REQUESTED_WINDOW]);
  expect(provider.verifiedIds).toHaveLength(VERIFICATION_BUDGET);
  return read;
};

/* Absent the report, nothing is withheld - which is exactly the guess this spec forbids. */
const resolveUnverifiedMappingIds = (
  read: VerifiedDestinationRemoteRead,
): ReadonlySet<string> => {
  if (!read.verification) {
    return new Set();
  }
  return read.verification.unverifiedMappingIds;
};

const createScope = (read: VerifiedDestinationRemoteRead) =>
  createDestinationReconciliationScope({
    authoritativeMappingIds: read.authoritativeMappingIds,
    authoritativeSourceWindows: new Map([[SOURCE_CALENDAR_ID, REQUESTED_WINDOW]]),
    authoritativeWindow: REQUESTED_WINDOW,
    eventReadDiagnostics: EVENT_READ_DIAGNOSTICS,
    requestedWindow: REQUESTED_WINDOW,
    sourceCalendarIdsAtLocalRead: [SOURCE_CALENDAR_ID],
    unverifiedMappingIds: resolveUnverifiedMappingIds(read),
  });

const getOperationMappingIds = (operation: SyncOperation): string[] => {
  if (operation.type === "add") {
    return [operation.event.id];
  }
  if (operation.type === "remove") {
    return [operation.uid, operation.deleteId];
  }
  return [operation.staleMappingId, operation.uid, operation.deleteId];
};

const touchesAnyIndex = (operation: SyncOperation, indexes: number[]): boolean => {
  const identifiers = getOperationMappingIds(operation);
  return indexes.some((index) =>
    identifiers.includes(createMapping(index).id)
    || identifiers.includes(createDeleteIdentifier(index))
    || identifiers.includes(createDestinationEventUid(index))
    || identifiers.includes(createLocalEvent(index).id));
};

describe("unverifiable mappings are reported, not guessed", () => {
  it("counts what the budget never established apart from present and absent", async () => {
    const read = await readDestination();

    expect(read.verification).toEqual({
      unverifiedCount: UNVERIFIED_COUNT,
      unverifiedMappingIds: new Set(UNVERIFIED_INDEXES.map((index) => createMapping(index).id)),
      verifiedAbsentCount: ABSENT_COUNT,
      verifiedPresentCount: PRESENT_COUNT,
    });
  });

  it("emits the unverified count as its own telemetry field", async () => {
    const read = await readDestination();

    const fields = createDestinationReconciliationWideEventFields({
      authoritativeWindow: REQUESTED_WINDOW,
      eventReadDiagnostics: EVENT_READ_DIAGNOSTICS,
      localReadDurationMs: 0,
      remoteReadDurationMs: 0,
      requestedWindow: REQUESTED_WINDOW,
      sourceCalendarIdsAtLocalRead: [SOURCE_CALENDAR_ID],
      sourceCalendarIdsBeforeRemoteRead: [SOURCE_CALENDAR_ID],
      verification: read.verification,
      verifiedSourceCalendarCount: 1,
    });

    expect(fields["reconciliation.verification.unverified_count"]).toBe(UNVERIFIED_COUNT);
    expect(fields["reconciliation.verification.verified_absent_count"]).toBe(ABSENT_COUNT);
    expect(fields["reconciliation.verification.verified_present_count"]).toBe(PRESENT_COUNT);
  });

  it("neither recreates nor deletes a mapping the budget never verified", async () => {
    const read = await readDestination();

    const { operations, staleReasonCounts } = computeSyncOperations(
      localEvents,
      existingMappings,
      read.remoteEvents,
      createScope(read),
    );

    expect(operations.filter((operation) => touchesAnyIndex(operation, UNVERIFIED_INDEXES)))
      .toEqual([]);
    expect(staleReasonCounts.remoteMissing).toBe(ABSENT_COUNT);
  });

  it("still restores the mirrors the verification read positively called absent", async () => {
    const read = await readDestination();

    const { operations } = computeSyncOperations(
      localEvents,
      existingMappings,
      read.remoteEvents,
      createScope(read),
    );

    const restored = operations.filter((operation) =>
      operation.type === "replace" && operation.remoteMissing === true);
    expect(restored).toHaveLength(ABSENT_COUNT);
    expect(restored.every((operation) => touchesAnyIndex(operation, ABSENT_INDEXES))).toBe(true);
  });
});
