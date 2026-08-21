import { describe, expect, it } from "vitest";
import { computeSyncOperations } from "../../../src/core/sync/operations";
import {
  createEditableEventContentSnapshot,
  createSyncEventContentHash,
  hashEditableEventContentSnapshot,
} from "../../../src/core/events/content-hash";
import { generateDeterministicEventUid } from "../../../src/core/events/identity";
import type { EventMapping } from "../../../src/core/events/mappings";
import type {
  MaterializedSyncableEvent,
  RemoteEvent,
  SyncOperation,
} from "../../../src/core/types";

const DESTINATION_CALENDAR_ID = "destination-calendar-id";

const RECONCILIATION_SCOPE = {
  authoritativeWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
  requestedWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
};

const createLocalEvent = (
  overrides: Partial<MaterializedSyncableEvent>,
): MaterializedSyncableEvent => ({
  calendarId: "source-calendar-id",
  calendarName: "Source",
  calendarUrl: null,
  description: "agenda for the weekly sync",
  endTime: new Date("2026-03-08T15:00:00.000Z"),
  eventStateId: "event-state-id-1",
  id: "event-state-id-1",
  location: "Room 101",
  sourceEventUid: "source-event-uid-1",
  startTime: new Date("2026-03-08T14:00:00.000Z"),
  summary: "Weekly sync",
  ...overrides,
});

interface DestinationState {
  mappings: EventMapping[];
  remoteEvents: RemoteEvent[];
}

const resolveDestinationUid = (event: MaterializedSyncableEvent): string =>
  generateDeterministicEventUid(`${event.id}:${DESTINATION_CALENDAR_ID}`);

const writeRemoteEvent = (
  event: MaterializedSyncableEvent,
  uid: string,
  deleteId: string,
): RemoteEvent => {
  const editableContent = createEditableEventContentSnapshot(event);

  return {
    deleteId,
    editableAvailability: event.availability ?? "busy",
    editableContent,
    editableContentHash: hashEditableEventContentSnapshot(editableContent),
    endTime: event.endTime,
    isKeeperEvent: true,
    startTime: event.startTime,
    uid,
  };
};

const seedDestination = (event: MaterializedSyncableEvent): DestinationState => {
  const uid = resolveDestinationUid(event);
  const deleteId = "provider-event-id-0";

  return {
    mappings: [{
      calendarId: DESTINATION_CALENDAR_ID,
      deleteIdentifier: deleteId,
      destinationEventUid: uid,
      endTime: event.endTime,
      eventStateId: event.eventStateId ?? event.id,
      id: "mapping-id-1",
      sourceCalendarId: event.calendarId,
      startTime: event.startTime,
      syncEventHash: createSyncEventContentHash(event),
      syncEventId: event.id,
    }],
    remoteEvents: [writeRemoteEvent(event, uid, deleteId)],
  };
};

const applyOperations = (
  state: DestinationState,
  operations: SyncOperation[],
  pass: number,
): DestinationState => {
  const mappings = new Map(state.mappings.map((mapping) => [mapping.id, mapping]));
  const remoteEvents = new Map(state.remoteEvents.map((remote) => [remote.uid, remote]));
  let writeCount = 0;

  for (const operation of operations) {
    if (operation.type === "remove") {
      remoteEvents.delete(operation.uid);
      if (operation.mappingId) {
        mappings.delete(operation.mappingId);
      }
      continue;
    }

    writeCount += 1;
    const uid = resolveDestinationUid(operation.event);
    const deleteId = `provider-event-id-${pass}-${writeCount}`;
    remoteEvents.set(uid, writeRemoteEvent(operation.event, uid, deleteId));

    if (operation.type === "replace") {
      const existing = mappings.get(operation.staleMappingId);
      if (existing) {
        mappings.set(existing.id, {
          ...existing,
          deleteIdentifier: deleteId,
          endTime: operation.event.endTime,
          startTime: operation.event.startTime,
          syncEventHash: createSyncEventContentHash(operation.event),
          syncEventId: operation.event.id,
        });
      }
      continue;
    }

    if (operation.staleMappingId) {
      mappings.delete(operation.staleMappingId);
    }
    mappings.set(`mapping-id-pass-${pass}-${writeCount}`, {
      calendarId: DESTINATION_CALENDAR_ID,
      deleteIdentifier: deleteId,
      destinationEventUid: uid,
      endTime: operation.event.endTime,
      eventStateId: operation.event.eventStateId ?? operation.event.id,
      id: `mapping-id-pass-${pass}-${writeCount}`,
      sourceCalendarId: operation.event.calendarId,
      startTime: operation.event.startTime,
      syncEventHash: createSyncEventContentHash(operation.event),
      syncEventId: operation.event.id,
    });
  }

  return {
    mappings: [...mappings.values()],
    remoteEvents: [...remoteEvents.values()],
  };
};

const reconcile = (event: MaterializedSyncableEvent, state: DestinationState) =>
  computeSyncOperations([event], state.mappings, state.remoteEvents, RECONCILIATION_SCOPE);

describe("the privacy flip settles after one pass", () => {
  it("rewrites every mirrored event once and then emits nothing while the flag stays on", () => {
    const visibleEvent = createLocalEvent({});
    const privateEvent = createLocalEvent({ isPrivate: true });
    const alreadyMirrored = seedDestination(visibleEvent);

    const firstPass = reconcile(privateEvent, alreadyMirrored);
    expect(firstPass.operations).not.toHaveLength(0);

    const afterFirstPass = applyOperations(alreadyMirrored, firstPass.operations, 1);
    const secondPass = reconcile(privateEvent, afterFirstPass);

    expect(secondPass.operations).toEqual([]);
    expect(secondPass.staleMappingIds).toEqual([]);
  });

  it("stays settled across a third pass with the flag still on", () => {
    const privateEvent = createLocalEvent({ isPrivate: true });
    const alreadyMirrored = seedDestination(createLocalEvent({}));

    const firstPass = reconcile(privateEvent, alreadyMirrored);
    const afterFirstPass = applyOperations(alreadyMirrored, firstPass.operations, 1);
    const secondPass = reconcile(privateEvent, afterFirstPass);
    const afterSecondPass = applyOperations(afterFirstPass, secondPass.operations, 2);
    const thirdPass = reconcile(privateEvent, afterSecondPass);

    expect(thirdPass.operations).toEqual([]);
    expect(afterSecondPass.remoteEvents).toHaveLength(1);
    expect(afterSecondPass.mappings).toHaveLength(1);
  });

  it("settles the same way after the flag is turned back off", () => {
    const visibleEvent = createLocalEvent({});
    const privateEvent = createLocalEvent({ isPrivate: true });
    const alreadyPrivate = seedDestination(privateEvent);

    const firstPass = reconcile(visibleEvent, alreadyPrivate);
    expect(firstPass.operations).not.toHaveLength(0);

    const afterFirstPass = applyOperations(alreadyPrivate, firstPass.operations, 1);
    const secondPass = reconcile(visibleEvent, afterFirstPass);

    expect(secondPass.operations).toEqual([]);
  });
});
