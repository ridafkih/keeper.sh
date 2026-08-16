import { describe, expect, it } from "vitest";
import { computeSyncOperations } from "../../../src/core/sync/operations";
import type { ReconciliationScope } from "../../../src/core/sync/operations";
import { classifyInboundChanges } from "../../../src/core/sync/write-back";
import { resolveWriteBackPolicyState } from "../../../src/core/sync/write-back-policy";
import type { WriteBackPolicy } from "../../../src/core/sync/write-back-policy";
import {
  createEditableEventContentHash,
  createSyncEventContentHash,
} from "../../../src/core/events/content-hash";
import type { EventMapping } from "../../../src/core/events/mappings";
import type {
  EventAvailability,
  MaterializedSyncableEvent,
  RemoteEvent,
} from "../../../src/core/types";

const SOURCE_CALENDAR_ID = "source-calendar-id";
const DESTINATION_CALENDAR_ID = "destination-calendar-id";
const EDITED_SUMMARY = "Renamed by the user on the copy";
const SOURCE_DESCRIPTION = "Bring the notes";
const SOURCE_LOCATION = "Room 4";
const START_TIME = new Date("2027-05-11T14:00:00.000Z");
const END_TIME = new Date("2027-05-11T15:00:00.000Z");

const TEST_WINDOW = {
  timeMax: new Date("2100-01-01T00:00:00.000Z"),
  timeMin: new Date("2000-01-01T00:00:00.000Z"),
};

type TwoWayReconciliationScope = ReconciliationScope & {
  writeBackPolicies?: ReadonlyMap<string, WriteBackPolicy>;
};

const sourceEvent: MaterializedSyncableEvent = {
  calendarId: SOURCE_CALENDAR_ID,
  calendarName: "Personal",
  calendarUrl: null,
  description: SOURCE_DESCRIPTION,
  endTime: END_TIME,
  eventStateId: "event-state-id-1",
  id: "event-state-id-1",
  location: SOURCE_LOCATION,
  sourceEventUid: "source-event-uid-1",
  startTime: START_TIME,
  summary: "Quarterly review",
};

const mapping: EventMapping = {
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier: "destination-delete-id-1",
  destinationAvailability: "busy" as EventAvailability,
  destinationContentHash: createEditableEventContentHash(sourceEvent),
  destinationDescription: sourceEvent.description,
  destinationEndTime: sourceEvent.endTime,
  destinationIsAllDay: false,
  destinationLocation: sourceEvent.location,
  destinationStartTime: sourceEvent.startTime,
  destinationSummary: sourceEvent.summary,
  destinationEventUid: "destination-uid-1",
  endTime: sourceEvent.endTime,
  eventStateId: sourceEvent.eventStateId ?? sourceEvent.id,
  id: "mapping-id-1",
  sourceCalendarId: SOURCE_CALENDAR_ID,
  startTime: sourceEvent.startTime,
  syncEventHash: createSyncEventContentHash(sourceEvent),
  syncEventId: sourceEvent.id,
};

const editedCopy: RemoteEvent = {
  deleteId: mapping.deleteIdentifier,
  editableAvailability: "busy" as EventAvailability,
  editableContentHash: createEditableEventContentHash({
    ...sourceEvent,
    summary: EDITED_SUMMARY,
  }),
  editableFields: {
    description: SOURCE_DESCRIPTION,
    isAllDay: false,
    location: SOURCE_LOCATION,
    summary: EDITED_SUMMARY,
  },
  endTime: mapping.endTime,
  isKeeperEvent: true,
  startTime: mapping.startTime,
  supportedAvailabilities: ["busy", "free"] as EventAvailability[],
  uid: mapping.destinationEventUid,
};

const buildPolicy = (writeBackState: string): WriteBackPolicy => {
  const resolved = resolveWriteBackPolicyState("edits_and_deletes", writeBackState);
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

const runWith = (writeBackState: string) => {
  const scope: TwoWayReconciliationScope = {
    authoritativeWindow: TEST_WINDOW,
    requestedWindow: TEST_WINDOW,
    writeBackPolicies: new Map([[SOURCE_CALENDAR_ID, buildPolicy(writeBackState)]]),
  };
  const inbound = classifyInboundChanges({
    existingMappings: [mapping],
    localEvents: [sourceEvent],
    now: new Date("2027-05-01T00:00:00.000Z"),
    remoteEvents: [editedCopy],
    remoteRawItemCount: 1,
    scope,
  });
  return {
    inbound,
    ...computeSyncOperations(
      [sourceEvent],
      [mapping],
      [editedCopy],
      scope,
      new Set(inbound.suppressedMappingIds),
    ),
  };
};

/*
 * The dashboard tells the user a quarantine left the source untouched. What it must also
 * say is that the edit they made on the copy does not survive: a quarantined pair resolves
 * to mode "off", so the very next one-way pass replaces the copy with the source again.
 */
describe("what a quarantine does to the edited copy", () => {
  it("resolves a quarantined pair to one-way", () => {
    expect(resolveWriteBackPolicyState("edits_and_deletes", "quarantined").writeBackMode)
      .toBe("off");
  });

  it("rebuilds the edited copy from the source once the pair is quarantined", () => {
    const result = runWith("quarantined");

    expect(result.staleMappingIds).toEqual([mapping.id]);
    expect(result.operations).toEqual([{
      deleteId: mapping.deleteIdentifier,
      event: sourceEvent,
      staleMappingId: mapping.id,
      type: "replace",
      uid: mapping.destinationEventUid,
    }]);
  });

  it("leaves the edited copy alone while the pair is healthy", () => {
    const result = runWith("ok");

    expect(result.operations).toEqual([]);
  });
});
