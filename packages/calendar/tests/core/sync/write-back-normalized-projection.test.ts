import { describe, expect, it } from "vitest";
import { computeSyncOperations } from "../../../src/core/sync/operations";
import type { ReconciliationScope } from "../../../src/core/sync/operations";
import { classifyInboundChanges } from "../../../src/core/sync/write-back";
import type { InboundClassification } from "../../../src/core/sync/write-back";
import { resolveWriteBackPolicyState } from "../../../src/core/sync/write-back-policy";
import type { WriteBackPolicy } from "../../../src/core/sync/write-back-policy";
import {
  createEditableEventContentHash,
  createSyncEventContentHash,
} from "../../../src/core/events/content-hash";
import { normalizeCalDAVEvent } from "../../../src/providers/caldav/destination/normalize-event";
import type { EventMapping } from "../../../src/core/events/mappings";
import type {
  EventAvailability,
  MaterializedSyncableEvent,
  RemoteEvent,
} from "../../../src/core/types";
import type { PendingUpdate } from "../../../src/core/sync-engine/types";

/*
 * The sync engine records mapping.syncEventHash from the destination's normalized
 * projection of the source event, so the classifier has to weigh the copy against that
 * same projection. These tests pin what the user is promised for an event the destination
 * reshapes — here a CalDAV destination rendering an HTML description as plain text: an
 * edit made on the copy reaches the original, and is not rebuilt away by the one-way path.
 * The projection is handed in exactly as the sync engine hands the provider's own.
 */

const SOURCE_CALENDAR_ID = "source-calendar-id";
const DESTINATION_CALENDAR_ID = "destination-calendar-id";
const EDITED_SUMMARY = "Renamed on the copy";
const START_TIME = new Date("2027-05-11T14:00:00.000Z");
const END_TIME = new Date("2027-05-11T15:00:00.000Z");
const FIRST_PASS = new Date("2027-05-01T00:00:00.000Z");
const SECOND_PASS = new Date("2027-05-01T00:05:00.000Z");

const TEST_WINDOW = {
  timeMax: new Date("2100-01-01T00:00:00.000Z"),
  timeMin: new Date("2000-01-01T00:00:00.000Z"),
};

type TwoWayReconciliationScope = ReconciliationScope & {
  writeBackPolicies?: ReadonlyMap<string, WriteBackPolicy>;
};

const buildSourceEvent = (description: string): MaterializedSyncableEvent => ({
  calendarId: SOURCE_CALENDAR_ID,
  calendarName: "Personal",
  calendarUrl: null,
  description,
  endTime: END_TIME,
  eventStateId: "event-state-id-1",
  id: "event-state-id-1",
  location: "Room 4",
  sourceEventUid: "source-event-uid-1",
  sourceFields: { description, location: "Room 4", title: "Quarterly review" },
  startTime: START_TIME,
  summary: "Quarterly review",
});

/*
 * Exactly what the sync engine writes: the hash and the times come from the projection the
 * destination provider was handed, never from the raw source row.
 */
const buildMapping = (projected: MaterializedSyncableEvent): EventMapping => ({
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier: "destination-delete-id-1",
  destinationEventUid: "destination-uid-1",
  endTime: projected.endTime,
  eventStateId: "event-state-id-1",
  id: "mapping-id-1",
  sourceCalendarId: SOURCE_CALENDAR_ID,
  startTime: projected.startTime,
  syncEventHash: createSyncEventContentHash(projected),
  syncEventId: "event-state-id-1",
});

const buildCopy = (
  projected: MaterializedSyncableEvent,
  summary: string,
): RemoteEvent => ({
  deleteId: "destination-delete-id-1",
  editableAvailability: "busy" as EventAvailability,
  editableContentHash: createEditableEventContentHash({ ...projected, summary }),
  editableFields: {
    description: projected.description ?? "",
    isAllDay: false,
    location: projected.location ?? "",
    summary,
  },
  endTime: projected.endTime,
  isKeeperEvent: true,
  startTime: projected.startTime,
  supportedAvailabilities: ["busy", "free"] as EventAvailability[],
  uid: "destination-uid-1",
});

const buildPolicy = (): WriteBackPolicy => {
  const resolved = resolveWriteBackPolicyState("edits_and_deletes", "ok");
  return {
    deleteApproved: resolved.deleteApproved,
    deleteApprovedAt: resolved.deleteApprovedAt,
    destinationCalendarId: DESTINATION_CALENDAR_ID,
    excludeEventDescription: false,
    excludeEventLocation: false,
    excludeEventName: false,
    paused: resolved.paused,
    sourceCalendarId: SOURCE_CALENDAR_ID,
    writeBackMode: resolved.writeBackMode,
  };
};

const readMappingUpdate = (
  classification: InboundClassification | undefined,
): PendingUpdate | null => {
  if (classification && "mappingUpdate" in classification && classification.mappingUpdate) {
    return classification.mappingUpdate;
  }
  return null;
};

const applyMappingUpdate = (
  mapping: EventMapping,
  update: PendingUpdate | null,
): EventMapping => {
  if (!update) {
    return mapping;
  }
  const { id: _id, ...fields } = update;
  return { ...mapping, ...fields } as EventMapping;
};

const runTwoPasses = (description: string): {
  operationTypes: string[];
  writeBacks: InboundClassification[];
} => {
  const sourceEvent = buildSourceEvent(description);
  const projected = normalizeCalDAVEvent(sourceEvent);
  const copy = buildCopy(projected, projected.summary);
  const editedCopy = buildCopy(projected, EDITED_SUMMARY);
  const scope: TwoWayReconciliationScope = {
    authoritativeWindow: TEST_WINDOW,
    requestedWindow: TEST_WINDOW,
    writeBackPolicies: new Map([[SOURCE_CALENDAR_ID, buildPolicy()]]),
  };

  // Pass one: the copy is untouched, so the witness of what Keeper.sh pushed is recorded.
  const firstMapping = buildMapping(projected);
  const first = classifyInboundChanges({
    existingMappings: [firstMapping],
    localEvents: [sourceEvent],
    projectLocalEvent: normalizeCalDAVEvent,
    now: FIRST_PASS,
    remoteEvents: [copy],
    remoteRawItemCount: 1,
    scope,
  });
  const witnessed = applyMappingUpdate(
    firstMapping,
    readMappingUpdate(first.classifications[0]),
  );

  // Pass two: the user has renamed the copy.
  const second = classifyInboundChanges({
    existingMappings: [witnessed],
    localEvents: [sourceEvent],
    projectLocalEvent: normalizeCalDAVEvent,
    now: SECOND_PASS,
    remoteEvents: [editedCopy],
    remoteRawItemCount: 1,
    scope,
  });

  const { operations } = computeSyncOperations(
    [projected],
    [witnessed],
    [editedCopy],
    scope,
    new Set(second.suppressedMappingIds),
  );

  return {
    operationTypes: operations.map((operation) => operation.type),
    writeBacks: second.classifications.filter(
      (classification) => classification.type === "write-back",
    ),
  };
};

describe("write-back against a projection the destination normalized", () => {
  it("writes a rename on the copy back to a source whose description carries markup", () => {
    const { writeBacks } = runTwoPasses("<p>Bring the notes</p>");

    expect(writeBacks).toHaveLength(1);
  });

  it("does not rebuild the edited copy from the source instead of writing it back", () => {
    const { operationTypes } = runTwoPasses("<p>Bring the notes</p>");

    expect(operationTypes).not.toContain("replace");
  });

  it("still writes the rename back when the projection is the source verbatim", () => {
    const { operationTypes, writeBacks } = runTwoPasses("Bring the notes");

    expect(writeBacks).toHaveLength(1);
    expect(operationTypes).not.toContain("replace");
  });
});
