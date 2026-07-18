import { describe, expect, it } from "vitest";
import {
  buildRemoveOperations,
  computeSyncOperations,
  matchRemoteEventsToMappings,
} from "../../../src/core/sync/operations";
import {
  createEditableEventContentHash,
  createSyncEventContentHash,
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
  remoteMissing: 0,
  remoteTimeChanged: 0,
};

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
      startTime: mapping.startTime,
      type: "remove",
      uid: mapping.destinationEventUid,
    }]);
  });
});

describe("computeSyncOperations", () => {
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
      mappingIdsToPrune: [],
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
      mappingIdsToPrune: [],
      operations: [],
      staleMappingIds: [],
      staleReasonCounts: EMPTY_STALE_REASON_COUNTS,
    });
  });

  it("prunes an expired occurrence mapping after it leaves the sliding window", () => {
    const mapping = createEventMapping({
      eventStateId: "master-event-state-id",
      endTime: new Date("2026-03-01T15:00:00.000Z"),
      id: "expired-occurrence-mapping",
      startTime: new Date("2026-03-01T14:00:00.000Z"),
      syncEventId: "expired-recurrence-occurrence",
    });

    expect(computeSyncOperations([], [mapping], [], {
      syncWindowStart: new Date("2026-03-03T00:00:00.000Z"),
    })).toEqual({
      mappingUpdates: [],
      mappingIdsToPrune: [mapping.id],
      operations: [],
      staleMappingIds: [],
      staleReasonCounts: EMPTY_STALE_REASON_COUNTS,
    });
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
      mappingIdsToPrune: [],
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
      mappingIdsToPrune: [],
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
      mappingIdsToPrune: [],
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
      mappingIdsToPrune: [],
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

    const result = computeSyncOperations([first, third], mappings, remoteEvents);

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
      deleteId: "legacy-1@keeper.sh",
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
      deleteId: mapping.deleteIdentifier,
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
    );

    expect(result.staleMappingIds).toEqual([]);
    expect(result.operations).toEqual([{
      deleteId: "duplicate-delete-id",
      startTime: event.startTime,
      type: "remove",
      uid: mapping.destinationEventUid,
    }]);
  });
});
