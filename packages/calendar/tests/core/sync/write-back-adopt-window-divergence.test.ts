import { describe, expect, it } from "vitest";
import { classifyInboundChanges } from "../../../src/core/sync/write-back";
import { computeSyncOperations } from "../../../src/core/sync/operations";
import type { ReconciliationScope } from "../../../src/core/sync/operations";
import {
  createEditableEventContentHash,
  createSyncEventContentHash,
  normalizeText,
} from "../../../src/core/events/content-hash";
import { resolveIsAllDayEvent } from "../../../src/core/events/all-day";
import type { EventMapping } from "../../../src/core/events/mappings";
import type {
  EventAvailability,
  MaterializedSyncableEvent,
  RemoteEvent,
} from "../../../src/core/types";

const DESTINATION_CALENDAR_ID = "destination-calendar-id";
const SOURCE_CALENDAR_ID = "source-calendar-id";
const START_TIME = new Date("2027-05-11T14:00:00.000Z");
const END_TIME = new Date("2027-05-11T15:00:00.000Z");
const NOW = new Date("2027-05-01T12:00:00.000Z");
const ONE_REPAIR = 1;
const NO_REPAIRS = 0;

const TEST_WINDOW = {
  timeMax: new Date("2100-01-01T00:00:00.000Z"),
  timeMin: new Date("2000-01-01T00:00:00.000Z"),
};

interface WriteBackPolicy {
  deleteApproved: boolean;
  destinationCalendarId: string;
  excludeEventDescription: boolean;
  excludeEventLocation: boolean;
  excludeEventName: boolean;
  paused: boolean;
  sourceCalendarId: string;
  writeBackMode: "edits" | "edits_and_deletes" | "off";
}

type TwoWayEventMapping = EventMapping & {
  destinationAvailability: EventAvailability | null;
  destinationContentHash: string | null;
  destinationDescription: string | null;
  destinationEndTime: Date | null;
  destinationIsAllDay: boolean | null;
  destinationLocation: string | null;
  destinationStartTime: Date | null;
  destinationSummary: string | null;
};

type TwoWayReconciliationScope = ReconciliationScope & {
  writeBackPolicies?: ReadonlyMap<string, WriteBackPolicy>;
};

const createLocalEvent = (
  overrides: Partial<MaterializedSyncableEvent> = {},
): MaterializedSyncableEvent => ({
  availability: "busy",
  calendarId: SOURCE_CALENDAR_ID,
  calendarName: "Personal",
  calendarUrl: null,
  description: "Bring the notes",
  endTime: END_TIME,
  eventStateId: "event-state-id-1",
  id: "event-state-id-1",
  location: "Room 4",
  sourceEventUid: "source-event-uid-1",
  startTime: START_TIME,
  summary: "Quarterly review",
  ...overrides,
});

/*
 * The state a mapping is in for the whole window between a push and the next read of the
 * copy: the push cleared every witness column, so nothing has been observed yet.
 */
const createUnverifiedMapping = (
  event: MaterializedSyncableEvent,
): TwoWayEventMapping => ({
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier: "destination-delete-id-1",
  destinationAvailability: null,
  destinationContentHash: null,
  destinationDescription: null,
  destinationEndTime: null,
  destinationEventUid: "destination-uid-1",
  destinationIsAllDay: null,
  destinationLocation: null,
  destinationStartTime: null,
  destinationSummary: null,
  endTime: event.endTime,
  eventStateId: event.eventStateId ?? event.id,
  id: "mapping-id-1",
  sourceCalendarId: event.calendarId,
  startTime: event.startTime,
  syncEventHash: createSyncEventContentHash(event),
  syncEventId: event.id,
});

const createRemoteEvent = (
  mapping: TwoWayEventMapping,
  shownOnTheCopy: MaterializedSyncableEvent,
): RemoteEvent => ({
  deleteId: mapping.deleteIdentifier,
  editableAvailability: "busy",
  editableContentHash: createEditableEventContentHash(shownOnTheCopy),
  editableFields: {
    description: shownOnTheCopy.description ?? "",
    isAllDay: resolveIsAllDayEvent({
      endTime: shownOnTheCopy.endTime,
      startTime: shownOnTheCopy.startTime,
    }),
    location: shownOnTheCopy.location ?? "",
    summary: shownOnTheCopy.summary,
  },
  endTime: shownOnTheCopy.endTime,
  isKeeperEvent: true,
  startTime: shownOnTheCopy.startTime,
  supportedAvailabilities: ["busy", "free"],
  uid: mapping.destinationEventUid,
});

const createScope = (
  writeBackMode: WriteBackPolicy["writeBackMode"],
): TwoWayReconciliationScope => {
  if (writeBackMode === "off") {
    return { authoritativeWindow: TEST_WINDOW, requestedWindow: TEST_WINDOW };
  }
  return {
    authoritativeWindow: TEST_WINDOW,
    requestedWindow: TEST_WINDOW,
    writeBackPolicies: new Map([[SOURCE_CALENDAR_ID, {
      deleteApproved: false,
      destinationCalendarId: DESTINATION_CALENDAR_ID,
      excludeEventDescription: false,
      excludeEventLocation: false,
      excludeEventName: false,
      paused: false,
      sourceCalendarId: SOURCE_CALENDAR_ID,
      writeBackMode,
    }]]),
  };
};

/*
 * Known unresolved, pinned rather than asserted as desirable: an edit in this window is
 * swallowed, and the dashboard tells the user it "may be replaced". Rebuilding the copy
 * instead loops forever against a destination that normalizes on write, which the
 * termination suite in tests/integration/two-way-write-back.ts holds the line on. Ending
 * the swallow needs the window itself closed, not a different answer inside it.
 */
describe("an edit made before the copy was first observed", () => {
  it("is neither written back to the original nor replaced on the copy", () => {
    const event = createLocalEvent();
    const mapping = createUnverifiedMapping(event);
    const editedOnTheCopy = createLocalEvent({ summary: "Renamed by the user on the copy" });
    const remoteEvent = createRemoteEvent(mapping, editedOnTheCopy);
    const scope = createScope("edits");

    const result = classifyInboundChanges({
      existingMappings: [mapping],
      localEvents: [event],
      now: NOW,
      remoteEvents: [remoteEvent],
      remoteRawItemCount: 1,
      scope,
    });

    const { operations } = computeSyncOperations(
      [event],
      [mapping],
      [remoteEvent],
      scope,
      new Set(result.suppressedMappingIds),
    );

    const wroteBack = result.classifications.some(({ type }) => type === "write-back");
    const replaced = operations.filter(({ type }) => type === "replace").length === ONE_REPAIR;
    expect({ replaced, wroteBack }).toEqual({ replaced: false, wroteBack: false });
  });

  it("is repaired on the copy under one-way sync", () => {
    const event = createLocalEvent();
    const mapping = createUnverifiedMapping(event);
    const editedOnTheCopy = createLocalEvent({ summary: "Renamed by the user on the copy" });
    const remoteEvent = createRemoteEvent(mapping, editedOnTheCopy);

    const { operations } = computeSyncOperations(
      [event],
      [mapping],
      [remoteEvent],
      createScope("off"),
    );

    expect(operations.filter(({ type }) => type === "replace")).toHaveLength(ONE_REPAIR);
  });

  it("leaves the copy permanently diverged once the edit has been adopted", () => {
    const event = createLocalEvent();
    const unverified = createUnverifiedMapping(event);
    const editedOnTheCopy = createLocalEvent({ summary: "Renamed by the user on the copy" });
    const remoteEvent = createRemoteEvent(unverified, editedOnTheCopy);
    const scope = createScope("edits");

    const first = classifyInboundChanges({
      existingMappings: [unverified],
      localEvents: [event],
      now: NOW,
      remoteEvents: [remoteEvent],
      remoteRawItemCount: 1,
      scope,
    });
    expect(first.counters.adoptWindowDivergence).toBe(1);

    const adopted: TwoWayEventMapping = {
      ...unverified,
      destinationAvailability: "busy",
      destinationContentHash: createEditableEventContentHash(editedOnTheCopy),
      destinationDescription: normalizeText(editedOnTheCopy.description),
      destinationEndTime: editedOnTheCopy.endTime,
      destinationIsAllDay: false,
      destinationLocation: normalizeText(editedOnTheCopy.location),
      destinationStartTime: editedOnTheCopy.startTime,
      destinationSummary: normalizeText(editedOnTheCopy.summary),
    };

    const second = classifyInboundChanges({
      existingMappings: [adopted],
      localEvents: [event],
      now: NOW,
      remoteEvents: [remoteEvent],
      remoteRawItemCount: 1,
      scope,
    });

    const { operations } = computeSyncOperations(
      [event],
      [adopted],
      [remoteEvent],
      scope,
      new Set(second.suppressedMappingIds),
    );
    expect(operations.filter(({ type }) => type === "replace")).toHaveLength(NO_REPAIRS);
    expect(second.classifications.map(({ type }) => type)).not.toContain("write-back");
  });
});
