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
  endTime: new Date("2026-03-08T15:00:00.000Z"),
  id: "event-state-id-1",
  sourceEventUid: "source-event-uid-1",
  startTime: new Date("2026-03-08T14:00:00.000Z"),
  summary: "Meeting",
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

const computeAgainstRewrittenRemote = (
  localOverrides: Partial<MaterializedSyncableEvent>,
  remoteOverrides: Partial<MaterializedSyncableEvent>,
) => {
  const event = createLocalEvent(localOverrides);
  const mapping = createEventMapping({
    endTime: event.endTime,
    startTime: event.startTime,
    syncEventHash: createSyncEventContentHash(event),
  });
  const rewrittenContent = createEditableEventContentSnapshot({ ...event, ...remoteOverrides });
  const remoteEvent: RemoteEvent = {
    deleteId: mapping.deleteIdentifier,
    editableAvailability: "busy",
    editableContent: rewrittenContent,
    editableContentHash: hashEditableEventContentSnapshot(rewrittenContent),
    endTime: event.endTime,
    isKeeperEvent: true,
    startTime: event.startTime,
    uid: mapping.destinationEventUid,
  };

  return computeSyncOperations(
    [event],
    [mapping],
    [remoteEvent],
    TEST_RECONCILIATION_SCOPE,
  );
};

describe("stale mapping remote content length attribution", () => {
  it("totals local and remote description lengths when the remote rewrote it", () => {
    const result = computeAgainstRewrittenRemote(
      { description: "agenda for the sync" },
      { description: "agenda" },
    );

    expect(result.staleReasonCounts.remoteContentDescriptionChanged).toBe(1);
    expect(result.staleReasonCounts.remoteContentDescriptionLocalLengthTotal).toBe(19);
    expect(result.staleReasonCounts.remoteContentDescriptionRemoteLengthTotal).toBe(6);
  });

  it("totals summary and location lengths under their own counters", () => {
    const result = computeAgainstRewrittenRemote(
      { location: "Room 101", summary: "Weekly" },
      { location: "Room 1", summary: "Weekly sync" },
    );

    expect(result.staleReasonCounts.remoteContentSummaryLocalLengthTotal).toBe(6);
    expect(result.staleReasonCounts.remoteContentSummaryRemoteLengthTotal).toBe(11);
    expect(result.staleReasonCounts.remoteContentLocationLocalLengthTotal).toBe(8);
    expect(result.staleReasonCounts.remoteContentLocationRemoteLengthTotal).toBe(6);
  });

  it("leaves length totals at zero for fields the remote did not change", () => {
    const result = computeAgainstRewrittenRemote(
      { description: "agenda", summary: "Weekly" },
      { description: "agenda!" },
    );

    expect(result.staleReasonCounts.remoteContentSummaryLocalLengthTotal).toBe(0);
    expect(result.staleReasonCounts.remoteContentSummaryRemoteLengthTotal).toBe(0);
    expect(result.staleReasonCounts.remoteContentLocationLocalLengthTotal).toBe(0);
  });

  it("records a zero remote total when the remote emptied a field", () => {
    const result = computeAgainstRewrittenRemote(
      { description: "agenda" },
      { description: "" },
    );

    expect(result.staleReasonCounts.remoteContentDescriptionChanged).toBe(1);
    expect(result.staleReasonCounts.remoteContentDescriptionLocalLengthTotal).toBe(6);
    expect(result.staleReasonCounts.remoteContentDescriptionRemoteLengthTotal).toBe(0);
  });
});
