import { describe, expect, it } from "vitest";
import { computeSyncOperations } from "../../../src/core/sync/operations";
import type { ReconciliationScope } from "../../../src/core/sync/operations";
import {
  createEditableEventContentHash,
  createSyncEventContentHash,
} from "../../../src/core/events/content-hash";
import type { EventMapping } from "../../../src/core/events/mappings";
import type { MaterializedSyncableEvent, RemoteEvent } from "../../../src/core/types";

const SOURCE = "source-calendar-id";
const DESTINATION = "destination-calendar-id";

const insideStart = new Date("2026-03-09T14:00:00.000Z");
const insideEnd = new Date("2026-03-09T15:00:00.000Z");
const outsideStart = new Date("2026-03-05T14:00:00.000Z");
const outsideEnd = new Date("2026-03-05T15:00:00.000Z");

const movedEvent: MaterializedSyncableEvent = {
  calendarId: SOURCE,
  calendarName: "Source",
  calendarUrl: null,
  endTime: insideEnd,
  eventStateId: "series",
  id: "occ-moved",
  sourceEventUid: "source-uid",
  startTime: insideStart,
  summary: "Standup",
};

const mappingOutside: EventMapping = {
  calendarId: DESTINATION,
  deleteIdentifier: "remote-delete-outside",
  destinationEventUid: "remote-uid-outside",
  endTime: outsideEnd,
  eventStateId: "series",
  id: "m-outside",
  remoteAvailability: null,
  remoteContentHash: null,
  remoteEndTime: null,
  remoteStartTime: null,
  sourceCalendarId: SOURCE,
  startTime: outsideStart,
  syncEventHash: "hash-outside",
  syncEventId: "occ-moved",
};

const mappingInside: EventMapping = {
  calendarId: DESTINATION,
  deleteIdentifier: "remote-delete-inside",
  destinationEventUid: "remote-uid-inside",
  endTime: insideEnd,
  eventStateId: "series",
  id: "m-inside",
  remoteAvailability: null,
  remoteContentHash: null,
  remoteEndTime: null,
  remoteStartTime: null,
  sourceCalendarId: SOURCE,
  startTime: insideStart,
  syncEventHash: "hash-inside",
  syncEventId: "occ-gone",
};

const remoteInside: RemoteEvent = {
  deleteId: "remote-delete-inside",
  editableAvailability: "busy",
  editableContentHash: createEditableEventContentHash(movedEvent),
  endTime: insideEnd,
  isKeeperEvent: true,
  startTime: insideStart,
  supportedAvailabilities: ["busy", "free"],
  uid: "remote-uid-inside",
};

const scope: ReconciliationScope = {
  authoritativeSourceWindows: new Map([[SOURCE, {
    timeMax: new Date("2026-03-10T00:00:00.000Z"),
    timeMin: new Date("2026-03-08T00:00:00.000Z"),
  }]]),
  authoritativeWindow: {
    timeMax: new Date("2026-03-10T00:00:00.000Z"),
    timeMin: new Date("2026-03-08T00:00:00.000Z"),
  },
  configuredSourceCalendarIds: new Set([SOURCE]),
  requestedWindow: {
    timeMax: new Date("2026-04-01T00:00:00.000Z"),
    timeMin: new Date("2026-03-01T00:00:00.000Z"),
  },
};

describe("occurrence reassignment collision probe", () => {
  it("does not reassign onto a syncEventId another surviving mapping holds", () => {
    const result = computeSyncOperations(
      [movedEvent],
      [mappingOutside, mappingInside],
      [remoteInside],
      scope,
    );

    const removedMappingIds = new Set(result.staleMappingIds);
    for (const operation of result.operations) {
      if (operation.type !== "remove" || !operation.mappingId) {
        continue;
      }
      removedMappingIds.add(operation.mappingId);
    }

    const survivors = new Map<string, string>();
    for (const mapping of [mappingOutside, mappingInside]) {
      if (!removedMappingIds.has(mapping.id)) {
        survivors.set(mapping.id, mapping.syncEventId);
      }
    }
    for (const update of result.mappingUpdates) {
      if (survivors.has(update.id)) {
        survivors.set(update.id, update.syncEventId);
      }
    }

    const seen = new Map<string, string>();
    const collisions: string[] = [];
    for (const [id, syncEventId] of survivors) {
      const previous = seen.get(syncEventId);
      if (previous) {
        collisions.push(`${previous} and ${id} both hold ${syncEventId}`);
      }
      seen.set(syncEventId, id);
    }

    expect({
      collisions,
      mappingUpdates: result.mappingUpdates,
      operations: result.operations,
      staleMappingIds: result.staleMappingIds,
      syncHash: createSyncEventContentHash(movedEvent),
    }).toMatchObject({ collisions: [] });
  });
});
