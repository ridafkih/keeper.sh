import { describe, expect, it } from "vitest";
import { buildRemoveOperations, computeSyncOperations } from "../../../src/core/sync/operations";
import {
  createEditableEventContentHash,
  createSyncEventContentHash,
} from "../../../src/core/events/content-hash";
import type { EventMapping } from "../../../src/core/events/mappings";
import type { RemoteEvent, SyncableEvent } from "../../../src/core/types";

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

const createLocalEvent = (overrides: Partial<SyncableEvent>): SyncableEvent => ({
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

describe("buildRemoveOperations", () => {
  it("does not remove mapped events from before the sync window", () => {
    const historicalMapping = createEventMapping({
      destinationEventUid: "historical-uid",
      eventStateId: "historical-event-state-id",
      id: "historical-mapping-id",
      startTime: new Date("2026-03-07T10:00:00.000Z"),
    });

    const operations = buildRemoveOperations(
      [historicalMapping],
      [],
      new Set<string>(),
      new Set<string>(),
      {
        now: new Date("2026-03-08T12:00:00.000Z"),
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
        now: new Date("2026-03-08T12:00:00.000Z"),
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
        now: new Date("2026-03-08T12:00:00.000Z"),
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
        now: new Date("2026-03-08T12:00:00.000Z"),
        syncWindowStart: new Date("2026-03-08T00:00:00.000Z"),
      },
    );

    expect(operations).toHaveLength(0);
  });
});

describe("computeSyncOperations", () => {
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
      mappingIdsToPrune: [],
      operations: [],
      staleMappingIds: [],
    });
  });

  it("prunes an expired occurrence mapping after it leaves the sliding window", () => {
    const mapping = createEventMapping({
      eventStateId: "master-event-state-id",
      id: "expired-occurrence-mapping",
      startTime: new Date("2026-03-01T14:00:00.000Z"),
      syncEventId: "expired-recurrence-occurrence",
    });

    expect(computeSyncOperations([], [mapping], [], {
      now: new Date("2026-03-10T12:00:00.000Z"),
      syncWindowStart: new Date("2026-03-03T00:00:00.000Z"),
    })).toEqual({
      mappingIdsToPrune: [mapping.id],
      operations: [],
      staleMappingIds: [],
    });
  });


  it("retries an add and retains the stale mapping identity when the remote copy is missing", () => {
    const event = createLocalEvent({});
    const mapping = createEventMapping({
      eventStateId: event.id,
      syncEventHash: createSyncEventContentHash(event),
    });

    const result = computeSyncOperations([event], [mapping], []);

    expect(result.staleMappingIds).toEqual([mapping.id]);
    expect(result.operations).toEqual([
      { event, staleMappingId: mapping.id, type: "add" },
    ]);
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
      mappingIdsToPrune: [],
      operations: [],
      staleMappingIds: [],
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

    expect(computeSyncOperations([event], [mapping], [editedRemote]).operations)
      .toEqual([{
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
      mappingIdsToPrune: [],
      operations: [],
      staleMappingIds: [],
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

    expect(computeSyncOperations([event], [mapping], [remoteEvent]).operations)
      .toHaveLength(1);
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
