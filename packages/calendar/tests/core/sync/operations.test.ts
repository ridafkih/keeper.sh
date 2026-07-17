import { describe, expect, it } from "vitest";
import { buildRemoveOperations, computeSyncOperations } from "../../../src/core/sync/operations";
import { createSyncEventContentHash } from "../../../src/core/events/content-hash";
import type { EventMapping } from "../../../src/core/events/mappings";
import type { RemoteEvent, SyncableEvent } from "../../../src/core/types";

const createEventMapping = (overrides: Partial<EventMapping>): EventMapping => ({
  calendarId: "destination-calendar-id",
  deleteIdentifier: "delete-identifier-1",
  destinationEventUid: "destination-uid-1",
  endTime: new Date("2026-03-08T15:00:00.000Z"),
  eventStateId: "event-state-id-1",
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
});
