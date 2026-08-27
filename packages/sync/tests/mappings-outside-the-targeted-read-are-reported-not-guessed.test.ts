import { describe, expect, it } from "vitest";
import { computeSyncOperations } from "@keeper.sh/calendar";
import type {
  EventMapping,
  MaterializedSyncableEvent,
  RemoteEvent,
  SyncOperation,
} from "@keeper.sh/calendar";
import {
  createDestinationReconciliationScope,
  createDestinationReconciliationWideEventFields,
  readDestinationRemoteEvents,
  TARGETED_DESTINATION_READ_LIMIT,
} from "../src/sync-user";

const SOURCE_CALENDAR_ID = "source-1";
const DESTINATION_CALENDAR_ID = "destination-1";

const REQUESTED_WINDOW = {
  timeMax: new Date("2026-08-01T00:00:00.000Z"),
  timeMin: new Date("2026-07-01T00:00:00.000Z"),
};

const createEventReadDiagnostics = (withheldEventStateIds: string[]) => ({
  candidateEventStateCount: 0,
  emptyTimeRangeCount: 0,
  excludedBySyncPolicyCount: 0,
  invertedTimeRangeCount: 0,
  materializedEventCount: 0,
  missingSourceEventUidCount: 0,
  outsideReconciliationWindowCount: 0,
  overBudgetSourceEventStateIds: withheldEventStateIds,
  overBudgetSourceEventUids: withheldEventStateIds,
  syncableEventCount: 0,
});

const PRESENT_INDEXES = [1, 2, 3];
const ABSENT_INDEXES = [4, 5];
const PLANNED_INDEXES = [...PRESENT_INDEXES, ...ABSENT_INDEXES];
const WITHHELD_INDEXES = Array.from(
  { length: TARGETED_DESTINATION_READ_LIMIT },
  (unused, offset) => PLANNED_INDEXES.length + 1 + offset,
);

const createStartTime = (index: number): Date =>
  new Date(Date.UTC(2026, 6, 2, 10, 0, 0) + index * 60 * 60 * 1000);

const createEndTime = (index: number): Date =>
  new Date(createStartTime(index).getTime() + 30 * 60 * 1000);

const createDeleteIdentifier = (index: number): string =>
  `destination-event-${String(index).padStart(3, "0")}`;

const createDestinationEventUid = (index: number): string =>
  `destination-uid-${String(index).padStart(3, "0")}`;

const createMappingId = (index: number): string => `mapping-${String(index).padStart(3, "0")}`;

const createEventStateId = (index: number): string => `event-state-${index}`;

const createLocalEvent = (index: number): MaterializedSyncableEvent => ({
  calendarId: SOURCE_CALENDAR_ID,
  calendarName: "Source",
  calendarUrl: null,
  endTime: createEndTime(index),
  eventStateId: createEventStateId(index),
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
  eventStateId: createEventStateId(index),
  id: createMappingId(index),
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

const localEvents = PLANNED_INDEXES.map((index) => createLocalEvent(index));
const existingMappings = [...PLANNED_INDEXES, ...WITHHELD_INDEXES]
  .map((index) => createMapping(index));

const EVENT_READ_DIAGNOSTICS = createEventReadDiagnostics(
  WITHHELD_INDEXES.map((index) => createEventStateId(index)),
);

const createProviderDouble = () => {
  const askedIds: string[] = [];
  const presentByDeleteId = new Map(
    PRESENT_INDEXES.map((index) => [createDeleteIdentifier(index), createRemoteEvent(index)]),
  );
  const collectPresent = (ids: string[]): RemoteEvent[] => {
    const found: RemoteEvent[] = [];
    for (const id of ids) {
      const remoteEvent = presentByDeleteId.get(id);
      if (remoteEvent) {
        found.push(remoteEvent);
      }
    }
    return found;
  };
  return {
    askedIds,
    getRemoteEventsByIds: (ids: string[]): Promise<RemoteEvent[]> => {
      askedIds.push(...ids);
      return Promise.resolve(collectPresent(ids));
    },
    listRemoteEvents: (): Promise<RemoteEvent[]> =>
      Promise.reject(new Error("the targeted read must not fall back to a windowed listing")),
  };
};

const readDestination = async () => {
  const provider = createProviderDouble();
  const read = await readDestinationRemoteEvents({
    existingMappings,
    localEvents,
    provider,
    requestedWindow: REQUESTED_WINDOW,
  });
  expect(provider.askedIds.toSorted())
    .toEqual(PLANNED_INDEXES.map((index) => createDeleteIdentifier(index)));
  return read;
};

const resolveUnverifiedMappingIds = (
  read: { verification?: { unverifiedMappingIds: ReadonlySet<string> } },
): ReadonlySet<string> => {
  if (!read.verification) {
    return new Set();
  }
  return read.verification.unverifiedMappingIds;
};

const createScope = (read: Awaited<ReturnType<typeof readDestination>>) =>
  createDestinationReconciliationScope({
    authoritativeMappingIds: read.authoritativeMappingIds,
    authoritativeSourceWindows: new Map([[SOURCE_CALENDAR_ID, REQUESTED_WINDOW]]),
    authoritativeWindow: REQUESTED_WINDOW,
    eventReadDiagnostics: EVENT_READ_DIAGNOSTICS,
    requestedWindow: REQUESTED_WINDOW,
    sourceCalendarIdsAtLocalRead: [SOURCE_CALENDAR_ID],
    unverifiedMappingIds: resolveUnverifiedMappingIds(read),
  });

const getOperationIdentifiers = (operation: SyncOperation): string[] => {
  if (operation.type === "add") {
    return [operation.event.id];
  }
  if (operation.type === "remove") {
    return [operation.uid, operation.deleteId];
  }
  return [operation.staleMappingId, operation.uid, operation.deleteId];
};

const touchesAnyIndex = (operation: SyncOperation, indexes: number[]): boolean => {
  const identifiers = getOperationIdentifiers(operation);
  return indexes.some((index) =>
    identifiers.includes(createMappingId(index))
    || identifiers.includes(createDeleteIdentifier(index))
    || identifiers.includes(createDestinationEventUid(index))
    || identifiers.includes(createLocalEvent(index).id));
};

describe("mappings the targeted read never asked about are reported, not guessed", () => {
  it("counts what the by-id read never established apart from present and absent", async () => {
    const read = await readDestination();

    expect(read.verification).toEqual({
      unverifiedCount: WITHHELD_INDEXES.length,
      unverifiedMappingIds: new Set(WITHHELD_INDEXES.map((index) => createMappingId(index))),
      verifiedAbsentCount: ABSENT_INDEXES.length,
      verifiedPresentCount: PRESENT_INDEXES.length,
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

    expect(fields["reconciliation.verification.unverified_count"])
      .toBe(WITHHELD_INDEXES.length);
    expect(fields["reconciliation.verification.verified_absent_count"])
      .toBe(ABSENT_INDEXES.length);
    expect(fields["reconciliation.verification.verified_present_count"])
      .toBe(PRESENT_INDEXES.length);
  });

  it("neither recreates nor deletes a withheld mapping the by-id read never asked about", async () => {
    const read = await readDestination();

    const { operations } = computeSyncOperations(
      localEvents,
      existingMappings,
      read.remoteEvents,
      createScope(read),
    );

    expect(operations.filter((operation) => touchesAnyIndex(operation, WITHHELD_INDEXES)))
      .toEqual([]);
  });

  it("still restores the mirrors the by-id read positively called absent", async () => {
    const read = await readDestination();

    const { operations } = computeSyncOperations(
      localEvents,
      existingMappings,
      read.remoteEvents,
      createScope(read),
    );

    const restored = operations.filter((operation) =>
      operation.type === "replace" && operation.remoteMissing === true);
    expect(restored).toHaveLength(ABSENT_INDEXES.length);
    expect(restored.every((operation) => touchesAnyIndex(operation, ABSENT_INDEXES))).toBe(true);
  });
});
