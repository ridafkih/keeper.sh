import { describe, expect, it } from "vitest";
import {
  buildRemoveOperations as buildRemoveOperationsStrict,
  computeSyncOperations as computeSyncOperationsStrict,
  matchRemoteEventsToMappings,
} from "../../../src/core/sync/operations";
import type { ReconciliationScope } from "../../../src/core/sync/operations";
import {
  DEFAULT_FUTURE_SYNC_RANGE,
  DEFAULT_HISTORIC_SYNC_RANGE,
  getConfigurableSyncWindow,
} from "../../../src/core/sync/sync-range";
import {
  createEditableEventContentHash,
  createEditableEventContentSnapshot,
  createSyncEventContentHash,
  hashEditableEventContentSnapshot,
} from "../../../src/core/events/content-hash";
import type { EventMapping } from "../../../src/core/events/mappings";
import type {
  MaterializedSyncableEvent,
  RemoteEvent,
} from "../../../src/core/types";

const createEventMapping = (overrides: Partial<EventMapping>): EventMapping => ({
  calendarId: "destination-calendar-id",
  deleteIdentifier: "delete-identifier-1",
  destinationEventUid: "destination-uid-1",
  endTime: new Date("2026-03-08T15:00:00.000Z"),
  eventStateId: "event-state-id-1",
  syncEventId: "event-state-id-1",
  id: "mapping-id-1",
  sourceCalendarId: "source-calendar-id",
  startTime: new Date("2026-03-08T14:00:00.000Z"),
  syncEventHash: "hash-1",
  ...overrides,
});

const createRemoteEvent = (overrides: Partial<RemoteEvent>): RemoteEvent => ({
  deleteId: "remote-delete-id-1",
  endTime: new Date("2026-03-08T15:00:00.000Z"),
  isKeeperEvent: false,
  startTime: new Date("2026-03-08T14:00:00.000Z"),
  uid: "remote-uid-1",
  ...overrides,
});

const createLocalEvent = (
  overrides: Partial<MaterializedSyncableEvent>,
): MaterializedSyncableEvent => ({
  calendarId: "source-calendar-id",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2026-03-08T15:00:00.000Z"),
  id: "event-state-id-1",
  sourceEventUid: "source-event-uid-1",
  startTime: new Date("2026-03-08T14:00:00.000Z"),
  summary: "Meeting",
  ...overrides,
});

const EMPTY_STALE_REASON_COUNTS = {
  localHashChanged: 0,
  occurrenceReassigned: 0,
  remoteAvailabilityChanged: 0,
  remoteContentChanged: 0,
  remoteContentAllDayChanged: 0,
  remoteContentDescriptionChanged: 0,
  remoteContentLocationChanged: 0,
  remoteContentSummaryChanged: 0,
  remoteMissing: 0,
  remoteTimeChanged: 0,
};

const TEST_WINDOW = {
  timeMax: new Date("2100-01-01T00:00:00.000Z"),
  timeMin: new Date("2000-01-01T00:00:00.000Z"),
};

interface LegacyBoundary {
  cleanupWindowEnd?: Date;
  cleanupWindowStart?: Date;
  syncWindowEnd?: Date;
  syncWindowStart: Date;
}

const toReconciliationScope = (
  boundary: LegacyBoundary | ReconciliationScope | undefined,
): ReconciliationScope => {
  if (!boundary) {
    return { authoritativeWindow: TEST_WINDOW, requestedWindow: TEST_WINDOW };
  }
  if ("authoritativeWindow" in boundary) {
    return boundary;
  }
  return {
    authoritativeWindow: {
      timeMax: boundary.syncWindowEnd ?? TEST_WINDOW.timeMax,
      timeMin: boundary.syncWindowStart,
    },
    requestedWindow: {
      timeMax: boundary.cleanupWindowEnd ?? TEST_WINDOW.timeMax,
      timeMin: boundary.cleanupWindowStart ?? TEST_WINDOW.timeMin,
    },
  };
};

const buildRemoveOperations = (
  mappings: EventMapping[],
  remoteEvents: RemoteEvent[],
  localEventIds: Set<string>,
  mappedRemoteIdentities: Set<string>,
  boundary?: LegacyBoundary | ReconciliationScope,
) => buildRemoveOperationsStrict(
  mappings,
  remoteEvents,
  localEventIds,
  mappedRemoteIdentities,
  matchRemoteEventsToMappings(mappings, remoteEvents),
  toReconciliationScope(boundary),
);

const computeSyncOperations = (
  localEvents: MaterializedSyncableEvent[],
  mappings: EventMapping[],
  remoteEvents: RemoteEvent[],
  boundary?: LegacyBoundary | ReconciliationScope,
) => computeSyncOperationsStrict(
  localEvents,
  mappings,
  remoteEvents,
  toReconciliationScope(boundary),
);

describe("buildRemoveOperations", () => {
  it("does not remove mapped events from before the sync window", () => {
    const historicalMapping = createEventMapping({
      destinationEventUid: "historical-uid",
      eventStateId: "historical-event-state-id",
      endTime: new Date("2026-03-07T11:00:00.000Z"),
      id: "historical-mapping-id",
      startTime: new Date("2026-03-07T10:00:00.000Z"),
    });

    const operations = buildRemoveOperations(
      [historicalMapping],
      [],
      new Set<string>(),
      new Set<string>(),
      {
        cleanupWindowStart: new Date("2026-03-01T00:00:00.000Z"),
        syncWindowStart: new Date("2026-03-08T00:00:00.000Z"),
      },
    );

    expect(operations).toHaveLength(0);
  });

  it("removes missing mapped events from inside the sync window", () => {
    const futureMapping = createEventMapping({
      deleteIdentifier: "future-delete-id",
      destinationEventUid: "future-uid",
      eventStateId: "future-event-state-id",
      id: "future-mapping-id",
      startTime: new Date("2026-03-08T13:00:00.000Z"),
    });

    const operations = buildRemoveOperations(
      [futureMapping],
      [],
      new Set<string>(),
      new Set<string>(),
      {
        syncWindowStart: new Date("2026-03-08T00:00:00.000Z"),
      },
    );

    expect(operations).toHaveLength(1);
    expect(operations[0]).toEqual({
      deleteId: "future-delete-id",
      mappingId: "future-mapping-id",
      startTime: new Date("2026-03-08T13:00:00.000Z"),
      type: "remove",
      uid: "future-uid",
    });
  });

  it("removes orphaned keeper events even when in the future", () => {
    const orphanedKeeperEvent = createRemoteEvent({
      deleteId: "orphaned-delete-id",
      isKeeperEvent: true,
      startTime: new Date("2026-03-08T18:00:00.000Z"),
      uid: "orphaned-uid",
    });

    const operations = buildRemoveOperations(
      [],
      [orphanedKeeperEvent],
      new Set<string>(),
      new Set<string>(),
      {
        syncWindowStart: new Date("2026-03-08T00:00:00.000Z"),
      },
    );

    expect(operations).toHaveLength(1);
    expect(operations[0]).toEqual({
      deleteId: "orphaned-delete-id",
      startTime: new Date("2026-03-08T18:00:00.000Z"),
      type: "remove",
      uid: "orphaned-uid",
    });
  });

  it("does not remove unmapped non-keeper future events", () => {
    const futureRemoteEvent = createRemoteEvent({
      deleteId: "future-remote-delete-id",
      isKeeperEvent: false,
      startTime: new Date("2026-03-08T18:00:00.000Z"),
      uid: "future-remote-uid",
    });

    const operations = buildRemoveOperations(
      [],
      [futureRemoteEvent],
      new Set<string>(),
      new Set<string>(),
      {
        syncWindowStart: new Date("2026-03-08T00:00:00.000Z"),
      },
    );

    expect(operations).toHaveLength(0);
  });

  it("does not remove an unmapped non-keeper event after it becomes historical", () => {
    const historicalRemoteEvent = createRemoteEvent({
      deleteId: "historical-user-delete-id",
      isKeeperEvent: false,
      startTime: new Date("2020-01-01T18:00:00.000Z"),
      uid: "historical-user-uid",
    });

    expect(buildRemoveOperations(
      [],
      [historicalRemoteEvent],
      new Set<string>(),
      new Set<string>(),
      { syncWindowStart: new Date("2026-03-08T00:00:00.000Z") },
    )).toEqual([]);
  });

  it("removes an untagged Outlook event when its mapping proves Keeper ownership", () => {
    const mapping = createEventMapping({
      deleteIdentifier: "mapped-outlook-id",
      destinationEventUid: "mapped-outlook-uid",
    });
    const mappedRemote = createRemoteEvent({
      deleteId: mapping.deleteIdentifier,
      isKeeperEvent: false,
      uid: mapping.destinationEventUid,
    });

    expect(buildRemoveOperations(
      [mapping],
      [mappedRemote],
      new Set<string>(),
      new Set([`${mapping.destinationEventUid}\u0000${mapping.deleteIdentifier}`]),
      { syncWindowStart: new Date("2026-03-01T00:00:00.000Z") },
    )).toEqual([{
      deleteId: mapping.deleteIdentifier,
      mappingId: "mapping-id-1",
      startTime: mapping.startTime,
      type: "remove",
      uid: mapping.destinationEventUid,
    }]);
  });
});

describe("computeSyncOperations", () => {
  it("adds a zero-duration event that sits exactly on the window lower edge", () => {
    const edge = new Date("2026-03-08T00:00:00.000Z");
    const event = createLocalEvent({ endTime: edge, startTime: edge });
    const window = { timeMax: new Date("2026-06-01T00:00:00.000Z"), timeMin: edge };

    const { operations } = computeSyncOperations([event], [], [], {
      authoritativeWindow: window,
      requestedWindow: window,
    });

    expect(operations).toEqual([{ event, type: "add" }]);
  });

  it("leaves a zero-duration event before the window lower edge out", () => {
    const edge = new Date("2026-03-08T00:00:00.000Z");
    const before = new Date(edge.getTime() - 1);
    const event = createLocalEvent({ endTime: before, startTime: before });
    const window = { timeMax: new Date("2026-06-01T00:00:00.000Z"), timeMin: edge };

    const { operations } = computeSyncOperations([event], [], [], {
      authoritativeWindow: window,
      requestedWindow: window,
    });

    expect(operations).toEqual([]);
  });

  it("adds an inverted event whose start sits inside the window", () => {
    const start = new Date("2026-03-09T00:00:00.000Z");
    const event = createLocalEvent({
      endTime: new Date("2026-03-04T00:00:00.000Z"),
      startTime: start,
    });
    const window = {
      timeMax: new Date("2026-06-01T00:00:00.000Z"),
      timeMin: new Date("2026-03-08T00:00:00.000Z"),
    };

    const { operations } = computeSyncOperations([event], [], [], {
      authoritativeWindow: window,
      requestedWindow: window,
    });

    expect(operations).toEqual([{ event, type: "add" }]);
  });

  it("removes a legacy uid mapping by the provider event id already listed remotely", () => {
    const mapping = createEventMapping({
      deleteIdentifier: "legacy-uid@google.com",
      destinationEventUid: "legacy-uid@google.com",
    });
    const remoteEvent = createRemoteEvent({
      deleteId: "google-event-id",
      endTime: mapping.endTime,
      isKeeperEvent: true,
      startTime: mapping.startTime,
      uid: mapping.destinationEventUid,
    });

    const { operations } = computeSyncOperations([], [mapping], [remoteEvent]);

    expect(operations).toEqual([
      {
        deleteId: "google-event-id",
        mappingId: "mapping-id-1",
        startTime: mapping.startTime,
        type: "remove",
        uid: "legacy-uid@google.com",
      },
    ]);
  });

  it("replaces a legacy uid mapping by the provider event id already listed remotely", () => {
    const event = createLocalEvent({});
    const mapping = createEventMapping({
      deleteIdentifier: "legacy-uid@google.com",
      destinationEventUid: "legacy-uid@google.com",
      syncEventHash: createSyncEventContentHash(event),
    });
    const remoteEvent = createRemoteEvent({
      deleteId: "google-event-id",
      endTime: new Date("2026-03-08T16:00:00.000Z"),
      isKeeperEvent: true,
      startTime: new Date("2026-03-08T15:00:00.000Z"),
      uid: mapping.destinationEventUid,
    });

    const { operations } = computeSyncOperations([event], [mapping], [remoteEvent]);

    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      deleteId: "google-event-id",
      type: "replace",
      uid: "legacy-uid@google.com",
    });
  });

  it("keeps a matching mapped far-future event without requiring an orphan marker", () => {
    const event = createLocalEvent({
      endTime: new Date("2040-03-15T10:00:00.000Z"),
      startTime: new Date("2040-03-15T09:00:00.000Z"),
    });
    const mapping = createEventMapping({
      deleteIdentifier: "far-future-outlook-id",
      destinationEventUid: "far-future-outlook-uid",
      endTime: event.endTime,
      startTime: event.startTime,
      syncEventHash: createSyncEventContentHash(event),
    });
    const remoteEvent = createRemoteEvent({
      deleteId: mapping.deleteIdentifier,
      endTime: event.endTime,
      isKeeperEvent: false,
      startTime: event.startTime,
      uid: mapping.destinationEventUid,
    });

    expect(computeSyncOperations([event], [mapping], [remoteEvent], {
      syncWindowStart: new Date("2026-07-10T00:00:00.000Z"),
    })).toEqual({
      mappingUpdates: [],
      operations: [],
      staleMappingIds: [],
      staleReasonCounts: EMPTY_STALE_REASON_COUNTS,
    });
  });

  it("tracks multiple materialized occurrences owned by the same event-state row", () => {
    const first = createLocalEvent({
      eventStateId: "master-event-state-id",
      id: "recurrence-first",
    });
    const second = createLocalEvent({
      endTime: new Date("2026-03-15T15:00:00.000Z"),
      eventStateId: "master-event-state-id",
      id: "recurrence-second",
      startTime: new Date("2026-03-15T14:00:00.000Z"),
    });
    const mappings = [first, second].map((event, index) => createEventMapping({
      deleteIdentifier: `delete-${index}`,
      destinationEventUid: `remote-${index}`,
      endTime: event.endTime,
      eventStateId: "master-event-state-id",
      id: `mapping-${index}`,
      startTime: event.startTime,
      syncEventHash: createSyncEventContentHash(event),
      syncEventId: event.id,
    }));
    const remotes = mappings.map((mapping) => createRemoteEvent({
      deleteId: mapping.deleteIdentifier,
      endTime: mapping.endTime,
      startTime: mapping.startTime,
      uid: mapping.destinationEventUid,
    }));

    expect(computeSyncOperations([first, second], mappings, remotes)).toEqual({
      mappingUpdates: [],
      operations: [],
      staleMappingIds: [],
      staleReasonCounts: EMPTY_STALE_REASON_COUNTS,
    });
  });

  it("removes a mapped event after it leaves the configured cleanup window", () => {
    const mapping = createEventMapping({
      eventStateId: "master-event-state-id",
      endTime: new Date("2026-03-01T15:00:00.000Z"),
      id: "expired-occurrence-mapping",
      startTime: new Date("2026-03-01T14:00:00.000Z"),
      syncEventId: "expired-recurrence-occurrence",
    });

    expect(computeSyncOperations([], [mapping], [], {
      cleanupWindowStart: new Date("2026-03-03T00:00:00.000Z"),
      syncWindowStart: new Date("2026-03-03T00:00:00.000Z"),
    })).toEqual({
      mappingUpdates: [],
      operations: [{
        deleteId: mapping.deleteIdentifier,
        mappingId: "expired-occurrence-mapping",
        startTime: mapping.startTime,
        type: "remove",
        uid: mapping.destinationEventUid,
      }],
      staleMappingIds: [],
      staleReasonCounts: EMPTY_STALE_REASON_COUNTS,
    });
  });

  it("does not reconcile a mapping inside the requested window but outside source coverage", () => {
    const historicalMapping = createEventMapping({
      endTime: new Date("2026-03-05T15:00:00.000Z"),
      eventStateId: "recurring-master-id",
      startTime: new Date("2026-03-05T14:00:00.000Z"),
      syncEventId: "historical-occurrence",
    });
    const enteringOccurrence = createLocalEvent({
      endTime: new Date("2026-03-10T15:00:00.000Z"),
      eventStateId: "recurring-master-id",
      id: "entering-occurrence",
      startTime: new Date("2026-03-10T14:00:00.000Z"),
    });
    const historicalRemote = createRemoteEvent({
      deleteId: historicalMapping.deleteIdentifier,
      endTime: historicalMapping.endTime,
      isKeeperEvent: true,
      startTime: historicalMapping.startTime,
      uid: historicalMapping.destinationEventUid,
    });

    const result = computeSyncOperations(
      [enteringOccurrence],
      [historicalMapping],
      [historicalRemote],
      {
        cleanupWindowEnd: new Date("2026-04-01T00:00:00.000Z"),
        cleanupWindowStart: new Date("2026-03-01T00:00:00.000Z"),
        syncWindowEnd: new Date("2026-04-01T00:00:00.000Z"),
        syncWindowStart: new Date("2026-03-08T00:00:00.000Z"),
      },
    );

    expect(result.operations).toEqual([{ event: enteringOccurrence, type: "add" }]);
    expect(result.staleMappingIds).toEqual([]);
  });


  it("replaces a mapped event when the remote copy is missing", () => {
    const event = createLocalEvent({});
    const mapping = createEventMapping({
      eventStateId: event.id,
      syncEventHash: createSyncEventContentHash(event),
    });

    const result = computeSyncOperations([event], [mapping], []);

    expect(result.staleMappingIds).toEqual([mapping.id]);
    expect(result.staleReasonCounts).toEqual({
      ...EMPTY_STALE_REASON_COUNTS,
      remoteMissing: 1,
    });
    expect(result.operations).toEqual([{
      deleteId: mapping.deleteIdentifier,
      event,
      staleMappingId: mapping.id,
      type: "replace",
      uid: mapping.destinationEventUid,
    }]);
  });

  it("recreates a mapped event when the same event ID moves", () => {
    const previousEvent = createLocalEvent({});
    const movedEvent = createLocalEvent({
      endTime: new Date("2026-03-08T17:00:00.000Z"),
      startTime: new Date("2026-03-08T16:00:00.000Z"),
    });
    const mapping = createEventMapping({
      destinationEventUid: "destination-uid-1",
      syncEventHash: createSyncEventContentHash(previousEvent),
    });
    const remoteEvent = createRemoteEvent({
      deleteId: mapping.deleteIdentifier,
      endTime: previousEvent.endTime,
      isKeeperEvent: true,
      startTime: previousEvent.startTime,
      uid: mapping.destinationEventUid,
    });

    const result = computeSyncOperations([movedEvent], [mapping], [remoteEvent]);

    expect(result.staleMappingIds).toEqual([mapping.id]);
    expect(result.staleReasonCounts).toEqual({
      ...EMPTY_STALE_REASON_COUNTS,
      localHashChanged: 1,
    });
    expect(result.operations).toEqual([
      {
        deleteId: mapping.deleteIdentifier,
        event: movedEvent,
        staleMappingId: mapping.id,
        type: "replace",
        uid: mapping.destinationEventUid,
      },
    ]);
  });

  it("restores a mapped event when the destination copy is moved by a user", () => {
    const event = createLocalEvent({});
    const mapping = createEventMapping({
      destinationEventUid: "destination-uid-1",
      endTime: event.endTime,
      startTime: event.startTime,
      syncEventHash: createSyncEventContentHash(event),
    });
    const movedRemoteEvent = createRemoteEvent({
      deleteId: mapping.deleteIdentifier,
      endTime: new Date("2026-03-08T18:00:00.000Z"),
      isKeeperEvent: true,
      startTime: new Date("2026-03-08T17:00:00.000Z"),
      uid: mapping.destinationEventUid,
    });

    const result = computeSyncOperations([event], [mapping], [movedRemoteEvent]);

    expect(result.staleReasonCounts).toEqual({
      ...EMPTY_STALE_REASON_COUNTS,
      remoteTimeChanged: 1,
    });
    expect(result.operations).toEqual([{
      deleteId: mapping.deleteIdentifier,
      event,
      staleMappingId: mapping.id,
      type: "replace",
      uid: mapping.destinationEventUid,
    }]);
  });

  it("attributes a remote content change to the field the provider rewrote", () => {
    const event = createLocalEvent({ description: "agenda v2", location: "Room 1" });
    const mapping = createEventMapping({
      endTime: event.endTime,
      startTime: event.startTime,
      syncEventHash: createSyncEventContentHash(event),
    });
    const rewrittenContent = createEditableEventContentSnapshot({
      ...event,
      description: "agenda v1",
    });
    const remoteEvent = createRemoteEvent({
      deleteId: mapping.deleteIdentifier,
      editableAvailability: "busy",
      editableContent: rewrittenContent,
      editableContentHash: hashEditableEventContentSnapshot(rewrittenContent),
      endTime: event.endTime,
      isKeeperEvent: true,
      startTime: event.startTime,
      uid: mapping.destinationEventUid,
    });

    const result = computeSyncOperations([event], [mapping], [remoteEvent]);

    expect(result.staleReasonCounts).toEqual({
      ...EMPTY_STALE_REASON_COUNTS,
      remoteContentChanged: 1,
      remoteContentDescriptionChanged: 1,
    });
  });

  it("attributes summary and all-day drift independently", () => {
    const event = createLocalEvent({ isAllDay: false, summary: "Busy" });
    const mapping = createEventMapping({
      endTime: event.endTime,
      startTime: event.startTime,
      syncEventHash: createSyncEventContentHash(event),
    });
    const rewrittenContent = createEditableEventContentSnapshot({
      ...event,
      isAllDay: true,
      summary: "Busy (copy)",
    });
    const remoteEvent = createRemoteEvent({
      deleteId: mapping.deleteIdentifier,
      editableAvailability: "busy",
      editableContent: rewrittenContent,
      editableContentHash: hashEditableEventContentSnapshot(rewrittenContent),
      endTime: event.endTime,
      isKeeperEvent: true,
      startTime: event.startTime,
      uid: mapping.destinationEventUid,
    });

    const result = computeSyncOperations([event], [mapping], [remoteEvent]);

    expect(result.staleReasonCounts).toEqual({
      ...EMPTY_STALE_REASON_COUNTS,
      remoteContentChanged: 1,
      remoteContentAllDayChanged: 1,
      remoteContentSummaryChanged: 1,
    });
  });

  it("counts only the aggregate when a provider reports no content snapshot", () => {
    const event = createLocalEvent({ description: "agenda v2" });
    const mapping = createEventMapping({
      endTime: event.endTime,
      startTime: event.startTime,
      syncEventHash: createSyncEventContentHash(event),
    });
    const remoteEvent = createRemoteEvent({
      deleteId: mapping.deleteIdentifier,
      editableAvailability: "busy",
      editableContentHash: createEditableEventContentHash({
        ...event,
        description: "agenda v1",
      }),
      endTime: event.endTime,
      isKeeperEvent: true,
      startTime: event.startTime,
      uid: mapping.destinationEventUid,
    });

    const result = computeSyncOperations([event], [mapping], [remoteEvent]);

    expect(result.staleReasonCounts).toEqual({
      ...EMPTY_STALE_REASON_COUNTS,
      remoteContentChanged: 1,
    });
  });

  it("does not churn when a destination serializes timestamps to whole seconds", () => {
    const event = createLocalEvent({
      endTime: new Date("2026-03-08T15:00:00.456Z"),
      startTime: new Date("2026-03-08T14:00:00.123Z"),
    });
    const mapping = createEventMapping({
      deleteIdentifier: "remote-delete-id-1",
      destinationEventUid: "remote-uid-1",
      endTime: event.endTime,
      startTime: event.startTime,
      syncEventHash: createSyncEventContentHash(event),
    });
    const remoteEvent = createRemoteEvent({
      endTime: new Date("2026-03-08T15:00:00.000Z"),
      startTime: new Date("2026-03-08T14:00:00.000Z"),
    });

    expect(computeSyncOperations([event], [mapping], [remoteEvent])).toEqual({
      mappingUpdates: [],
      operations: [],
      staleMappingIds: [],
      staleReasonCounts: EMPTY_STALE_REASON_COUNTS,
    });
  });

  it("restores destination content edited without a time change", () => {
    const event = createLocalEvent({ summary: "Authoritative title" });
    const mapping = createEventMapping({
      deleteIdentifier: "remote-delete-id-1",
      destinationEventUid: "remote-uid-1",
      endTime: event.endTime,
      startTime: event.startTime,
      syncEventHash: createSyncEventContentHash(event),
    });
    const editedRemote = createRemoteEvent({
      editableContentHash: createEditableEventContentHash({ summary: "User edit" }),
      endTime: event.endTime,
      startTime: event.startTime,
    });

    const result = computeSyncOperations([event], [mapping], [editedRemote]);

    expect(result.staleReasonCounts).toEqual({
      ...EMPTY_STALE_REASON_COUNTS,
      remoteContentChanged: 1,
    });
    expect(result.operations).toEqual([{
        deleteId: mapping.deleteIdentifier,
        event,
        staleMappingId: mapping.id,
        type: "replace",
        uid: mapping.destinationEventUid,
      }]);
  });

  it("does not churn when a provider coerces unsupported OOO availability to busy", () => {
    const event = createLocalEvent({ availability: "oof" });
    const mapping = createEventMapping({
      deleteIdentifier: "remote-delete-id-1",
      destinationEventUid: "remote-uid-1",
      endTime: event.endTime,
      startTime: event.startTime,
      syncEventHash: createSyncEventContentHash(event),
    });
    const remoteEvent = createRemoteEvent({
      editableAvailability: "busy",
      editableContentHash: createEditableEventContentHash({
        availability: "busy",
        summary: event.summary,
      }),
      endTime: event.endTime,
      startTime: event.startTime,
      supportedAvailabilities: ["busy", "free"],
    });

    expect(computeSyncOperations([event], [mapping], [remoteEvent])).toEqual({
      mappingUpdates: [],
      operations: [],
      staleMappingIds: [],
      staleReasonCounts: EMPTY_STALE_REASON_COUNTS,
    });
  });

  it("restores a supported destination free/busy edit", () => {
    const event = createLocalEvent({ availability: "busy" });
    const mapping = createEventMapping({
      deleteIdentifier: "remote-delete-id-1",
      destinationEventUid: "remote-uid-1",
      endTime: event.endTime,
      startTime: event.startTime,
      syncEventHash: createSyncEventContentHash(event),
    });
    const remoteEvent = createRemoteEvent({
      editableAvailability: "free",
      editableContentHash: createEditableEventContentHash(event),
      endTime: event.endTime,
      startTime: event.startTime,
      supportedAvailabilities: ["busy", "free"],
    });

    const result = computeSyncOperations([event], [mapping], [remoteEvent]);

    expect(result.operations).toHaveLength(1);
    expect(result.staleReasonCounts).toEqual({
      ...EMPTY_STALE_REASON_COUNTS,
      remoteAvailabilityChanged: 1,
    });
  });

  it("matches a legacy Google UID delete identifier to the provider event ID", () => {
    const event = createLocalEvent({});
    const legacyUid = "legacy-google-event@keeper.sh";
    const mapping = createEventMapping({
      deleteIdentifier: legacyUid,
      destinationEventUid: legacyUid,
      endTime: event.endTime,
      startTime: event.startTime,
      syncEventHash: createSyncEventContentHash(event),
    });
    const remoteEvent = createRemoteEvent({
      deleteId: "google-provider-event-id",
      editableContentHash: createEditableEventContentHash(event),
      endTime: event.endTime,
      isKeeperEvent: true,
      startTime: event.startTime,
      uid: legacyUid,
    });

    expect(computeSyncOperations([event], [mapping], [remoteEvent])).toEqual({
      mappingUpdates: [{
        deleteIdentifier: remoteEvent.deleteId,
        id: mapping.id,
        syncEventHash: createSyncEventContentHash(event),
        syncEventId: event.id,
      }],
      operations: [],
      staleMappingIds: [],
      staleReasonCounts: EMPTY_STALE_REASON_COUNTS,
    });
  });

  it("does not guess between duplicate remote events sharing a legacy UID", () => {
    const legacyUid = "ambiguous-legacy-event@keeper.sh";
    const mapping = createEventMapping({
      deleteIdentifier: legacyUid,
      destinationEventUid: legacyUid,
    });
    const first = createRemoteEvent({ deleteId: "provider-id-1", uid: legacyUid });
    const second = createRemoteEvent({ deleteId: "provider-id-2", uid: legacyUid });

    expect(matchRemoteEventsToMappings([mapping], [first, second])).toEqual(new Map());
  });

  it("migrates a legacy recurring mapping identity without rewriting the remote event", () => {
    const event = createLocalEvent({
      eventStateId: "recurring-master-id",
      id: "materialized-occurrence-id",
    });
    const legacyUid = "legacy-occurrence@keeper.sh";
    const mapping = createEventMapping({
      deleteIdentifier: legacyUid,
      destinationEventUid: legacyUid,
      endTime: event.endTime,
      eventStateId: "recurring-master-id",
      startTime: event.startTime,
      syncEventHash: "legacy-master-hash",
      syncEventId: "recurring-master-id",
    });
    const remoteEvent = createRemoteEvent({
      deleteId: "google-provider-occurrence-id",
      editableAvailability: "busy",
      editableContentHash: createEditableEventContentHash(event),
      endTime: event.endTime,
      isKeeperEvent: true,
      startTime: event.startTime,
      uid: legacyUid,
    });

    expect(computeSyncOperations([event], [mapping], [remoteEvent])).toEqual({
      mappingUpdates: [{
        deleteIdentifier: remoteEvent.deleteId,
        id: mapping.id,
        syncEventHash: createSyncEventContentHash(event),
        syncEventId: event.id,
      }],
      operations: [],
      staleMappingIds: [],
      staleReasonCounts: EMPTY_STALE_REASON_COUNTS,
    });
  });

  it("does not shift later recurring mappings when one legacy occurrence was removed", () => {
    const first = createLocalEvent({
      eventStateId: "recurring-master-id",
      id: "first-occurrence-id",
    });
    const third = createLocalEvent({
      endTime: new Date("2026-03-22T15:00:00.000Z"),
      eventStateId: "recurring-master-id",
      id: "third-occurrence-id",
      startTime: new Date("2026-03-22T14:00:00.000Z"),
    });
    const removedSlot = createLocalEvent({
      endTime: new Date("2026-03-15T15:00:00.000Z"),
      eventStateId: "recurring-master-id",
      id: "removed-occurrence-id",
      startTime: new Date("2026-03-15T14:00:00.000Z"),
    });
    const mappedEvents = [first, removedSlot, third];
    const mappings = mappedEvents.map((event, index) => createEventMapping({
      deleteIdentifier: `legacy-${index}@keeper.sh`,
      destinationEventUid: `legacy-${index}@keeper.sh`,
      endTime: event.endTime,
      eventStateId: "recurring-master-id",
      id: `legacy-mapping-${index}`,
      startTime: event.startTime,
      syncEventHash: "legacy-master-hash",
      syncEventId: "recurring-master-id",
    }));
    const remoteEvents = mappedEvents.map((event, index) => createRemoteEvent({
      deleteId: `google-provider-id-${index}`,
      editableAvailability: "busy",
      editableContentHash: createEditableEventContentHash(event),
      endTime: event.endTime,
      isKeeperEvent: true,
      startTime: event.startTime,
      uid: `legacy-${index}@keeper.sh`,
    }));

    const result = computeSyncOperations([first, third], mappings, remoteEvents, {
      syncWindowEnd: new Date("2026-04-01T00:00:00.000Z"),
      syncWindowStart: new Date("2026-03-01T00:00:00.000Z"),
    });

    expect(result.mappingUpdates).toEqual([
      {
        deleteIdentifier: remoteEvents[0]?.deleteId,
        id: "legacy-mapping-0",
        syncEventHash: createSyncEventContentHash(first),
        syncEventId: first.id,
      },
      {
        deleteIdentifier: remoteEvents[2]?.deleteId,
        id: "legacy-mapping-2",
        syncEventHash: createSyncEventContentHash(third),
        syncEventId: third.id,
      },
    ]);
    expect(result.operations).toEqual([{
      deleteId: "google-provider-id-1",
      mappingId: "legacy-mapping-1",
      startTime: removedSlot.startTime,
      type: "remove",
      uid: "legacy-1@keeper.sh",
    }]);
    expect(result.staleMappingIds).toEqual([]);
  });

  it("rewrites a legacy recurring remote only when its editable state differs", () => {
    const event = createLocalEvent({
      eventStateId: "recurring-master-id",
      id: "materialized-occurrence-id",
    });
    const mapping = createEventMapping({
      deleteIdentifier: "legacy-occurrence@keeper.sh",
      destinationEventUid: "legacy-occurrence@keeper.sh",
      endTime: event.endTime,
      eventStateId: "recurring-master-id",
      startTime: event.startTime,
      syncEventHash: "legacy-master-hash",
      syncEventId: "recurring-master-id",
    });
    const remoteEvent = createRemoteEvent({
      deleteId: "google-provider-occurrence-id",
      editableAvailability: "busy",
      editableContentHash: createEditableEventContentHash({ summary: "Edited remotely" }),
      endTime: event.endTime,
      isKeeperEvent: true,
      startTime: event.startTime,
      uid: mapping.destinationEventUid,
    });

    const result = computeSyncOperations([event], [mapping], [remoteEvent]);

    expect(result.mappingUpdates).toEqual([]);
    expect(result.staleReasonCounts).toEqual({
      ...EMPTY_STALE_REASON_COUNTS,
      occurrenceReassigned: 1,
    });
    expect(result.operations).toEqual([{
      deleteId: remoteEvent.deleteId,
      event,
      staleMappingId: mapping.id,
      type: "replace",
      uid: mapping.destinationEventUid,
    }]);
    expect(result.staleMappingIds).toEqual([mapping.id]);
  });

  it("removes a duplicate remote copy without deleting the canonical mapping", () => {
    const event = createLocalEvent({});
    const mapping = createEventMapping({
      deleteIdentifier: "canonical-delete-id",
      destinationEventUid: "shared-remote-uid",
      endTime: event.endTime,
      startTime: event.startTime,
      syncEventHash: createSyncEventContentHash(event),
    });
    const canonicalRemote = createRemoteEvent({
      deleteId: mapping.deleteIdentifier,
      endTime: event.endTime,
      isKeeperEvent: true,
      startTime: event.startTime,
      uid: mapping.destinationEventUid,
    });
    const duplicateRemote = createRemoteEvent({
      deleteId: "duplicate-delete-id",
      endTime: event.endTime,
      isKeeperEvent: true,
      startTime: event.startTime,
      uid: mapping.destinationEventUid,
    });

    const result = computeSyncOperations(
      [event],
      [mapping],
      [duplicateRemote, canonicalRemote],
      {
        syncWindowEnd: new Date("2026-04-01T00:00:00.000Z"),
        syncWindowStart: new Date("2026-03-01T00:00:00.000Z"),
      },
    );

    expect(result.staleMappingIds).toEqual([]);
    expect(result.operations).toEqual([{
      deleteId: "duplicate-delete-id",
      startTime: event.startTime,
      type: "remove",
      uid: mapping.destinationEventUid,
    }]);
  });

  it("limits unverified reconciliation to explicit requested-window cleanup", () => {
    const insideMapping = createEventMapping({
      endTime: new Date("2026-03-08T15:00:00.000Z"),
      startTime: new Date("2026-03-08T14:00:00.000Z"),
    });
    const outsideMapping = createEventMapping({
      endTime: new Date("2026-02-01T15:00:00.000Z"),
      id: "outside-mapping",
      startTime: new Date("2026-02-01T14:00:00.000Z"),
    });
    const keeperOrphan = createRemoteEvent({
      isKeeperEvent: true,
      uid: "keeper-orphan",
    });

    const result = computeSyncOperationsStrict(
      [],
      [insideMapping, outsideMapping],
      [keeperOrphan],
      {
        authoritativeWindow: null,
        requestedWindow: {
          timeMax: new Date("2026-04-01T00:00:00.000Z"),
          timeMin: new Date("2026-03-01T00:00:00.000Z"),
        },
      },
    );

    expect(result.operations).toEqual([{
      deleteId: outsideMapping.deleteIdentifier,
      mappingId: "outside-mapping",
      startTime: outsideMapping.startTime,
      type: "remove",
      uid: outsideMapping.destinationEventUid,
    }]);
  });

  it("syncs verified sources without deleting mappings owned by an unverified source", () => {
    const healthyEvent = createLocalEvent({
      calendarId: "healthy-source",
      id: "healthy-event",
    });
    const unverifiedMapping = createEventMapping({
      id: "unverified-mapping",
      sourceCalendarId: "unverified-source",
      syncEventId: "unverified-event",
    });

    const result = computeSyncOperationsStrict(
      [healthyEvent],
      [unverifiedMapping],
      [],
      {
        authoritativeSourceWindows: new Map([["healthy-source", TEST_WINDOW]]),
        authoritativeWindow: null,
        configuredSourceCalendarIds: new Set(["healthy-source", "unverified-source"]),
        requestedWindow: TEST_WINDOW,
      },
    );

    expect(result.operations).toEqual([{
      event: healthyEvent,
      type: "add",
    }]);
  });

  it("does not re-add an event whose mapping sits between recorded coverage and the requested edge", () => {
    const coverageEdge = new Date("2028-08-05T00:00:00.000Z");
    const requestedWindow = {
      timeMax: new Date("2028-08-11T00:00:00.000Z"),
      timeMin: new Date("2026-08-04T00:00:00.000Z"),
    };
    const authoritativeWindow = {
      timeMax: coverageEdge,
      timeMin: requestedWindow.timeMin,
    };
    const event = createLocalEvent({
      endTime: new Date("2026-09-01T15:00:00.000Z"),
      id: "banded-event",
      startTime: new Date("2026-09-01T14:00:00.000Z"),
    });
    const bandedMapping = createEventMapping({
      endTime: new Date("2028-08-08T15:00:00.000Z"),
      id: "banded-mapping",
      startTime: new Date("2028-08-08T14:00:00.000Z"),
      syncEventId: "banded-event",
    });

    const result = computeSyncOperationsStrict([event], [bandedMapping], [], {
      authoritativeSourceWindows: new Map([["source-calendar-id", authoritativeWindow]]),
      authoritativeWindow,
      configuredSourceCalendarIds: new Set(["source-calendar-id"]),
      requestedWindow,
    });

    expect(result.operations).toEqual([]);
  });

  it("uses a retained mapping tombstone to remove an untagged event from a deleted source", () => {
    const deletedSourceMapping = createEventMapping({
      id: "deleted-source-mapping",
      sourceCalendarId: "deleted-source",
      syncEventId: "deleted-source-event",
    });
    const remoteEvent = createRemoteEvent({
      deleteId: deletedSourceMapping.deleteIdentifier,
      isKeeperEvent: false,
      uid: deletedSourceMapping.destinationEventUid,
    });

    const result = computeSyncOperationsStrict(
      [],
      [deletedSourceMapping],
      [remoteEvent],
      {
        authoritativeSourceWindows: new Map(),
        authoritativeWindow: TEST_WINDOW,
        configuredSourceCalendarIds: new Set(),
        requestedWindow: TEST_WINDOW,
      },
    );

    expect(result.operations).toEqual([{
      deleteId: deletedSourceMapping.deleteIdentifier,
      mappingId: "deleted-source-mapping",
      startTime: deletedSourceMapping.startTime,
      type: "remove",
      uid: deletedSourceMapping.destinationEventUid,
    }]);
  });

  it("removes a migration-window tombstone whose source identity was not backfilled", () => {
    const deletedSourceMapping = createEventMapping({
      id: "migration-window-tombstone",
      sourceCalendarId: null,
      syncEventId: "deleted-source-event",
    });
    const remoteEvent = createRemoteEvent({
      deleteId: deletedSourceMapping.deleteIdentifier,
      isKeeperEvent: false,
      uid: deletedSourceMapping.destinationEventUid,
    });

    const result = computeSyncOperationsStrict(
      [],
      [deletedSourceMapping],
      [remoteEvent],
      {
        authoritativeSourceWindows: new Map(),
        authoritativeWindow: TEST_WINDOW,
        configuredSourceCalendarIds: new Set(),
        requestedWindow: TEST_WINDOW,
      },
    );

    expect(result.operations).toEqual([{
      deleteId: deletedSourceMapping.deleteIdentifier,
      mappingId: "migration-window-tombstone",
      startTime: deletedSourceMapping.startTime,
      type: "remove",
      uid: deletedSourceMapping.destinationEventUid,
    }]);
  });

  it("retires a one-off mapping beyond the future edge once its source event is gone", () => {
    const now = new Date("2026-08-11T00:00:00.000Z");
    const requestedWindow = getConfigurableSyncWindow(
      DEFAULT_HISTORIC_SYNC_RANGE,
      DEFAULT_FUTURE_SYNC_RANGE,
      now,
    );
    const farFutureMapping = createEventMapping({
      endTime: new Date("2029-08-11T15:00:00.000Z"),
      id: "far-future-mapping",
      startTime: new Date("2029-08-11T14:00:00.000Z"),
      syncEventId: "far-future-event",
    });

    const result = computeSyncOperationsStrict([], [farFutureMapping], [], {
      authoritativeSourceWindows: new Map([["source-calendar-id", requestedWindow]]),
      authoritativeWindow: requestedWindow,
      configuredSourceCalendarIds: new Set(["source-calendar-id"]),
      requestedWindow,
    });

    expect(result.operations).toEqual([{
      deleteId: farFutureMapping.deleteIdentifier,
      mappingId: "far-future-mapping",
      startTime: farFutureMapping.startTime,
      type: "remove",
      uid: farFutureMapping.destinationEventUid,
    }]);
  });

  it("retires a mapping left beyond a narrowed future edge", () => {
    const requestedWindow = {
      timeMax: new Date("2027-01-01T00:00:00.000Z"),
      timeMin: new Date("2026-01-01T00:00:00.000Z"),
    };
    const beyondEdgeMapping = createEventMapping({
      endTime: new Date("2028-06-01T15:00:00.000Z"),
      id: "beyond-edge-mapping",
      startTime: new Date("2028-06-01T14:00:00.000Z"),
      syncEventId: "beyond-edge-event",
    });

    const result = computeSyncOperationsStrict([], [beyondEdgeMapping], [], {
      authoritativeSourceWindows: new Map([["source-calendar-id", requestedWindow]]),
      authoritativeWindow: requestedWindow,
      configuredSourceCalendarIds: new Set(["source-calendar-id"]),
      requestedWindow,
    });

    expect(result.operations).toEqual([{
      deleteId: beyondEdgeMapping.deleteIdentifier,
      mappingId: "beyond-edge-mapping",
      startTime: beyondEdgeMapping.startTime,
      type: "remove",
      uid: beyondEdgeMapping.destinationEventUid,
    }]);
  });

  it("keeps the mirrors of a series withheld for exceeding the occurrence budget", () => {
    const occurrenceMappings = [1, 2, 3].map((index) => createEventMapping({
      endTime: new Date(`2026-03-0${index}T15:00:00.000Z`),
      eventStateId: "over-budget-series",
      id: `over-budget-mapping-${index}`,
      startTime: new Date(`2026-03-0${index}T14:00:00.000Z`),
      syncEventId: `over-budget-series::occurrence-${index}`,
    }));

    const result = computeSyncOperationsStrict([], occurrenceMappings, [], {
      authoritativeSourceWindows: new Map([["source-calendar-id", TEST_WINDOW]]),
      authoritativeWindow: TEST_WINDOW,
      configuredSourceCalendarIds: new Set(["source-calendar-id"]),
      requestedWindow: TEST_WINDOW,
      withheldSourceEventStateIds: new Set(["over-budget-series"]),
    });

    expect(result.operations).toEqual([]);
  });

  it("still retires a withheld series' mapping once it falls outside the requested window", () => {
    const requestedWindow = {
      timeMax: new Date("2027-01-01T00:00:00.000Z"),
      timeMin: new Date("2026-01-01T00:00:00.000Z"),
    };
    const withheldOutsideMapping = createEventMapping({
      endTime: new Date("2028-06-01T15:00:00.000Z"),
      eventStateId: "over-budget-series",
      id: "over-budget-outside-mapping",
      startTime: new Date("2028-06-01T14:00:00.000Z"),
      syncEventId: "over-budget-series::occurrence-outside",
    });

    const result = computeSyncOperationsStrict([], [withheldOutsideMapping], [], {
      authoritativeSourceWindows: new Map([["source-calendar-id", requestedWindow]]),
      authoritativeWindow: requestedWindow,
      configuredSourceCalendarIds: new Set(["source-calendar-id"]),
      requestedWindow,
      withheldSourceEventStateIds: new Set(["over-budget-series"]),
    });

    expect(result.operations).toEqual([{
      deleteId: withheldOutsideMapping.deleteIdentifier,
      mappingId: "over-budget-outside-mapping",
      startTime: withheldOutsideMapping.startTime,
      type: "remove",
      uid: withheldOutsideMapping.destinationEventUid,
    }]);
  });
});
