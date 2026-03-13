import { describe, expect, it } from "bun:test";
import { computeSyncOperations } from "./operations";
import type { EventMapping } from "../events/mappings";
import type { RemoteEvent, SyncableEvent } from "../types";
import { createSyncEventContentHash } from "../events/content-hash";

const timeBoundary = {
  now: new Date("2026-03-08T12:00:00.000Z"),
  syncWindowStart: new Date("2026-03-01T00:00:00.000Z"),
};

const createLocalEvent = (overrides: Partial<SyncableEvent>): SyncableEvent => ({
  availability: "busy",
  calendarId: "source-calendar-id",
  calendarName: "Source Calendar",
  calendarUrl: null,
  endTime: new Date("2026-03-08T15:00:00.000Z"),
  id: "event-state-1",
  sourceEventUid: "source-uid-1",
  startTime: new Date("2026-03-08T14:00:00.000Z"),
  summary: "Meeting",
  ...overrides,
});

const createMapping = (overrides: Partial<EventMapping>): EventMapping => ({
  calendarId: "destination-calendar-id",
  deleteIdentifier: "delete-id-1",
  destinationEventUid: "keeper-uid-1@keeper.sh",
  endTime: new Date("2026-03-08T15:00:00.000Z"),
  eventStateId: "event-state-1",
  id: "mapping-id-1",
  startTime: new Date("2026-03-08T14:00:00.000Z"),
  syncEventHash: null,
  ...overrides,
});

const createRemoteKeeperEvent = (overrides: Partial<RemoteEvent>): RemoteEvent => ({
  deleteId: "keeper-uid-1@keeper.sh",
  endTime: new Date("2026-03-08T15:00:00.000Z"),
  isKeeperEvent: true,
  startTime: new Date("2026-03-08T14:00:00.000Z"),
  uid: "keeper-uid-1@keeper.sh",
  ...overrides,
});

describe("computeSyncOperations", () => {
  describe("orphan removal with no local events and no mappings", () => {
    it("does not remove remote keeper events when the destination has no local events and no mappings", () => {
      const remoteKeeperEvents: RemoteEvent[] = [
        createRemoteKeeperEvent({ uid: "uid-1@keeper.sh", deleteId: "uid-1@keeper.sh" }),
        createRemoteKeeperEvent({ uid: "uid-2@keeper.sh", deleteId: "uid-2@keeper.sh" }),
        createRemoteKeeperEvent({ uid: "uid-3@keeper.sh", deleteId: "uid-3@keeper.sh" }),
      ];

      const result = computeSyncOperations([], [], remoteKeeperEvents, timeBoundary);
      const removeOperations = result.operations.filter((op) => op.type === "remove");

      expect(removeOperations).toHaveLength(0);
    });

    it("simulates multi-cycle oscillation between two destinations sharing a remote", () => {
      const localEvents = [
        createLocalEvent({ id: "es-1", sourceEventUid: "src-1" }),
        createLocalEvent({ id: "es-2", sourceEventUid: "src-2" }),
        createLocalEvent({ id: "es-3", sourceEventUid: "src-3" }),
      ];

      const cycle1 = computeSyncOperations(localEvents, [], [], timeBoundary);
      const cycle1Adds = cycle1.operations.filter((op) => op.type === "add");
      expect(cycle1Adds).toHaveLength(3);

      const mappingsAfterCycle1: EventMapping[] = localEvents.map((event, index) => {
        const hash = createSyncEventContentHash(event);
        return createMapping({
          destinationEventUid: `pushed-uid-${index}@keeper.sh`,
          deleteIdentifier: `pushed-uid-${index}@keeper.sh`,
          eventStateId: event.id,
          id: `mapping-${index}`,
          syncEventHash: hash,
          startTime: event.startTime,
          endTime: event.endTime,
        });
      });

      const remoteAfterCycle1: RemoteEvent[] = mappingsAfterCycle1.map((mapping) =>
        createRemoteKeeperEvent({
          uid: mapping.destinationEventUid,
          deleteId: mapping.destinationEventUid,
          startTime: mapping.startTime,
          endTime: mapping.endTime,
        }),
      );

      const cycle2CalA = computeSyncOperations(
        localEvents,
        mappingsAfterCycle1,
        remoteAfterCycle1,
        timeBoundary,
      );
      expect(cycle2CalA.operations).toHaveLength(0);

      const cycle2CalB = computeSyncOperations([], [], remoteAfterCycle1, timeBoundary);
      const cycle2CalBRemoves = cycle2CalB.operations.filter((op) => op.type === "remove");

      expect(cycle2CalBRemoves).toHaveLength(0);
    });
  });

  describe("user removes all sources from a destination", () => {
    it("removes all events via mapping path when sources are removed but mappings still exist", () => {
      const mappings: EventMapping[] = [
        createMapping({
          destinationEventUid: "uid-1@keeper.sh",
          deleteIdentifier: "uid-1@keeper.sh",
          eventStateId: "es-1",
          id: "m-1",
        }),
        createMapping({
          destinationEventUid: "uid-2@keeper.sh",
          deleteIdentifier: "uid-2@keeper.sh",
          eventStateId: "es-2",
          id: "m-2",
        }),
      ];

      const remoteEvents: RemoteEvent[] = [
        createRemoteKeeperEvent({ uid: "uid-1@keeper.sh", deleteId: "uid-1@keeper.sh" }),
        createRemoteKeeperEvent({ uid: "uid-2@keeper.sh", deleteId: "uid-2@keeper.sh" }),
      ];

      const result = computeSyncOperations([], mappings, remoteEvents, timeBoundary);
      const removeOps = result.operations.filter((op) => op.type === "remove");

      expect(removeOps).toHaveLength(2);
    });
  });

  describe("legitimate orphan cleanup", () => {
    it("removes orphaned keeper events when the destination has active source mappings", () => {
      const localEvents = [
        createLocalEvent({ id: "es-1" }),
        createLocalEvent({ id: "es-2" }),
      ];
      const [firstEvent, secondEvent] = localEvents;

      if (!firstEvent || !secondEvent) {
        throw new Error("expected localEvents fixtures to include two events");
      }

      const hash1 = createSyncEventContentHash(firstEvent);
      const hash2 = createSyncEventContentHash(secondEvent);

      const mappings: EventMapping[] = [
        createMapping({
          destinationEventUid: "uid-1@keeper.sh",
          eventStateId: "es-1",
          id: "m-1",
          syncEventHash: hash1,
        }),
        createMapping({
          destinationEventUid: "uid-2@keeper.sh",
          eventStateId: "es-2",
          id: "m-2",
          syncEventHash: hash2,
        }),
      ];

      const remoteEvents: RemoteEvent[] = [
        createRemoteKeeperEvent({ uid: "uid-1@keeper.sh", deleteId: "uid-1@keeper.sh" }),
        createRemoteKeeperEvent({ uid: "uid-2@keeper.sh", deleteId: "uid-2@keeper.sh" }),
        createRemoteKeeperEvent({ uid: "orphan@keeper.sh", deleteId: "orphan@keeper.sh" }),
      ];

      const result = computeSyncOperations(localEvents, mappings, remoteEvents, timeBoundary);
      const removeOps = result.operations.filter((op) => op.type === "remove");

      expect(removeOps).toHaveLength(1);
      expect(removeOps[0]).toMatchObject({ uid: "orphan@keeper.sh", type: "remove" });
    });
  });
});
