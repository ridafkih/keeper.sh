import { describe, expect, it } from "vitest";
import { computeSyncOperations } from "../../../src/core/sync/operations";
import {
  createEditableEventContentSnapshot,
  createSyncEventContentHash,
  hashEditableEventContentSnapshot,
} from "../../../src/core/events/content-hash";
import type { EventMapping } from "../../../src/core/events/mappings";
import type { MaterializedSyncableEvent, RemoteEvent } from "../../../src/core/types";

const TEST_RECONCILIATION_SCOPE = {
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
  description: "agenda for the sync",
  endTime: new Date("2026-03-08T15:00:00.000Z"),
  id: "event-state-id-1",
  location: "Room 101",
  sourceEventUid: "source-event-uid-1",
  startTime: new Date("2026-03-08T14:00:00.000Z"),
  summary: "Weekly sync",
  ...overrides,
});

const createEventMapping = (overrides: Partial<EventMapping>): EventMapping => ({
  calendarId: "destination-calendar-id",
  deleteIdentifier: "delete-identifier-1",
  destinationEventUid: "destination-uid-1",
  endTime: new Date("2026-03-08T15:00:00.000Z"),
  eventStateId: "event-state-id-1",
  id: "mapping-id-1",
  sourceCalendarId: "source-calendar-id",
  startTime: new Date("2026-03-08T14:00:00.000Z"),
  syncEventHash: "hash-1",
  syncEventId: "event-state-id-1",
  ...overrides,
});

const computeAfterFlip = (
  alreadySynced: MaterializedSyncableEvent,
  localNow: MaterializedSyncableEvent,
) => {
  const mapping = createEventMapping({
    endTime: alreadySynced.endTime,
    startTime: alreadySynced.startTime,
    syncEventHash: createSyncEventContentHash(alreadySynced),
  });
  const mirroredContent = createEditableEventContentSnapshot(alreadySynced);
  const remoteEvent: RemoteEvent = {
    deleteId: mapping.deleteIdentifier,
    editableAvailability: "busy",
    editableContent: mirroredContent,
    editableContentHash: hashEditableEventContentSnapshot(mirroredContent),
    endTime: alreadySynced.endTime,
    isKeeperEvent: true,
    startTime: alreadySynced.startTime,
    uid: mapping.destinationEventUid,
  };

  return computeSyncOperations(
    [localNow],
    [mapping],
    [remoteEvent],
    TEST_RECONCILIATION_SCOPE,
  );
};

describe("mark events as private restales already synced events", () => {
  const visibleEvent = createLocalEvent({});
  const privateEvent = createLocalEvent({ isPrivate: true });

  it("emits operations when the option is turned on for an already mirrored event", () => {
    const result = computeAfterFlip(visibleEvent, privateEvent);

    expect(result.operations).not.toHaveLength(0);
  });

  it("emits operations when the option is turned off again", () => {
    const result = computeAfterFlip(privateEvent, visibleEvent);

    expect(result.operations).not.toHaveLength(0);
  });

  it("emits nothing on a second pass while the option stays on", () => {
    const result = computeAfterFlip(privateEvent, privateEvent);

    expect(result.operations).toHaveLength(0);
  });

  it("still emits operations when only the summary changed", () => {
    const result = computeAfterFlip(visibleEvent, createLocalEvent({ summary: "Renamed sync" }));

    expect(result.operations).not.toHaveLength(0);
  });
});
