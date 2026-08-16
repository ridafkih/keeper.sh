import { describe, expect, it } from "vitest";
import { classifyInboundChanges } from "../../../src/core/sync/write-back";
import { computeSyncOperations } from "../../../src/core/sync/operations";
import type { ReconciliationScope } from "../../../src/core/sync/operations";
import {
  createEditableEventContentHash,
  createSyncEventContentHash,
  normalizeText,
} from "../../../src/core/events/content-hash";
import type { EventMapping } from "../../../src/core/events/mappings";
import type { MaterializedSyncableEvent, RemoteEvent } from "../../../src/core/types";

const SOURCE_CALENDAR_ID = "source-calendar-id";
const DESTINATION_CALENDAR_ID = "destination-calendar-id";
const MAPPING_ID = "mapping-id-1";
const START_TIME = new Date("2027-05-11T14:00:00.000Z");
const END_TIME = new Date("2027-05-11T15:00:00.000Z");
const NOW = new Date("2027-05-01T12:00:00.000Z");
const RENAMED_BY_THE_USER = "Weekly standup (moved to the cafe)";
const QUARANTINE_LIMIT = 5;
const MINUTE_MS = 60_000;

const TEST_WINDOW = {
  timeMax: new Date("2100-01-01T00:00:00.000Z"),
  timeMin: new Date("2000-01-01T00:00:00.000Z"),
};

interface Privacy {
  excludeEventDescription: boolean;
  excludeEventLocation: boolean;
  excludeEventName: boolean;
}

const SHOWS_EVERYTHING: Privacy = {
  excludeEventDescription: false,
  excludeEventLocation: false,
  excludeEventName: false,
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
  sourceFields: {
    description: "Bring the notes",
    location: "Room 4",
    title: "Weekly standup",
  },
  startTime: START_TIME,
  summary: "Weekly standup",
  ...overrides,
});

const createWitnessedMapping = (
  event: MaterializedSyncableEvent,
  overrides: Partial<EventMapping> = {},
): EventMapping => ({
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier: "destination-delete-id-1",
  destinationAvailability: "busy",
  destinationContentHash: createEditableEventContentHash(event),
  destinationDescription: normalizeText(event.description),
  destinationEndTime: event.endTime,
  destinationEventUid: "destination-uid-1",
  destinationIsAllDay: false,
  destinationLocation: normalizeText(event.location),
  destinationStartTime: event.startTime,
  destinationSummary: normalizeText(event.summary),
  endTime: event.endTime,
  eventStateId: event.eventStateId ?? event.id,
  id: MAPPING_ID,
  missingFirstObservedAt: null,
  missingObservationCount: 0,
  recurrenceId: null,
  recurrenceRule: null,
  sourceCalendarId: SOURCE_CALENDAR_ID,
  startTime: event.startTime,
  syncEventHash: createSyncEventContentHash(event),
  syncEventId: event.id,
  writeBackDailyCount: 0,
  writeBackDailyWindowStart: null,
  writeBackEpoch: 0,
  writeBackEpochWindowStart: null,
  ...overrides,
});

const createRenamedRemoteEvent = (
  mapping: EventMapping,
  event: MaterializedSyncableEvent,
): RemoteEvent => {
  const renamed = { ...event, summary: RENAMED_BY_THE_USER };
  return {
    deleteId: mapping.deleteIdentifier,
    editableAvailability: "busy",
    editableContentHash: createEditableEventContentHash(renamed),
    editableFields: {
      description: renamed.description,
      isAllDay: false,
      location: renamed.location,
      summary: renamed.summary,
    },
    endTime: mapping.endTime,
    isKeeperEvent: true,
    startTime: mapping.startTime,
    supportedAvailabilities: ["busy", "free"],
    uid: mapping.destinationEventUid,
  } as RemoteEvent;
};

const buildScope = (
  privacy: Privacy,
  writeBackMode: "edits" | "edits_and_deletes" | "off",
): ReconciliationScope => ({
  authoritativeWindow: TEST_WINDOW,
  requestedWindow: TEST_WINDOW,
  ...(writeBackMode !== "off" && {
    writeBackPolicies: new Map([[SOURCE_CALENDAR_ID, {
      deleteApproved: false,
      destinationCalendarId: DESTINATION_CALENDAR_ID,
      ...privacy,
      paused: false,
      sourceCalendarId: SOURCE_CALENDAR_ID,
      writeBackMode,
    }]]),
  }),
});

const runPass = (
  event: MaterializedSyncableEvent,
  mapping: EventMapping,
  privacy: Privacy,
  writeBackMode: "edits" | "edits_and_deletes" | "off",
) => {
  const remoteEvents = [createRenamedRemoteEvent(mapping, event)];
  const scope = buildScope(privacy, writeBackMode);
  const classified = classifyInboundChanges({
    existingMappings: [mapping],
    localEvents: [event],
    now: NOW,
    remoteEvents,
    remoteRawItemCount: remoteEvents.length,
    scope,
  });
  const operations = computeSyncOperations(
    [event],
    [mapping],
    remoteEvents,
    scope,
    new Set(classified.suppressedMappingIds),
  );

  return {
    classification: classified.classifications.find(
      (candidate) => candidate.mappingId === MAPPING_ID,
    ),
    repairs: operations.operations.filter((operation) => operation.type === "replace"),
  };
};

describe("two-way sync: a copy the source can never adopt is put back, not kept", () => {
  it("repairs an edited copy under one-way sync", () => {
    const event = createLocalEvent();

    expect(runPass(event, createWitnessedMapping(event), SHOWS_EVERYTHING, "off").repairs)
      .toHaveLength(1);
  });

  it("repairs an edited copy of a repeating event", () => {
    const event = createLocalEvent();
    const mapping = createWitnessedMapping(event, { recurrenceRule: "FREQ=WEEKLY" });
    const { classification, repairs } = runPass(event, mapping, SHOWS_EVERYTHING, "edits");

    expect(classification).toMatchObject({ reason: "recurring_event", type: "rejected" });
    expect(classification).not.toHaveProperty("mappingUpdate");
    expect(repairs).toHaveLength(1);
  });

  it("repairs an edited copy whose title the user chose to hide", () => {
    const event = createLocalEvent({ summary: "Personal" });
    const mapping = createWitnessedMapping(event);
    const { classification, repairs } = runPass(
      event,
      mapping,
      { ...SHOWS_EVERYTHING, excludeEventName: true },
      "edits",
    );

    expect(classification).toMatchObject({ reason: "redacted_field", type: "rejected" });
    expect(classification).not.toHaveProperty("mappingUpdate");
    expect(repairs).toHaveLength(1);
  });

  /*
   * The one unwritable case that must NOT be repaired. Rebuilding the copy rebuilds the
   * mapping, and a rebuilt mapping has spent no budget — so the destination that exhausted
   * the budget by oscillating would be handed a fresh one on every pass, and the source
   * would be written to without bound. tests/integration/two-way-write-back.test.ts holds
   * the termination guarantee this protects.
   */
  it("adopts rather than repairs an edited copy whose write-back budget is spent", () => {
    const event = createLocalEvent();
    const mapping = createWitnessedMapping(event, {
      writeBackEpoch: QUARANTINE_LIMIT,
      writeBackEpochWindowStart: new Date(NOW.getTime() - MINUTE_MS),
      writeBackLastAppliedAt: NOW,
    });
    const { classification, repairs } = runPass(event, mapping, SHOWS_EVERYTHING, "edits");

    expect(classification).toMatchObject({
      mappingUpdate: { destinationSummary: RENAMED_BY_THE_USER },
      reason: "write_back_quarantined",
      type: "rejected",
    });
    expect(repairs).toHaveLength(0);
  });

  it("still adopts what a destination re-encoded from our own push", () => {
    const event = createLocalEvent();
    const mapping = createWitnessedMapping(event, { recurrenceRule: "FREQ=WEEKLY" });
    const reEncoded = {
      ...createRenamedRemoteEvent(mapping, event),
      editableContentHash: "a-hash-the-destination-computed-differently",
      editableFields: {
        description: "Bring the notes\n",
        isAllDay: false,
        location: "Room 4",
        summary: "Weekly standup",
      },
    } as RemoteEvent;
    const scope = buildScope(SHOWS_EVERYTHING, "edits");
    const classified = classifyInboundChanges({
      existingMappings: [mapping],
      localEvents: [event],
      now: NOW,
      remoteEvents: [reEncoded],
      remoteRawItemCount: 1,
      scope,
    });

    expect(classified.classifications[0]).toMatchObject({
      mappingUpdate: { destinationSummary: "Weekly standup" },
      reason: "recurring_event",
      type: "rejected",
    });
    expect(classified.suppressedMappingIds).toContain(MAPPING_ID);
  });
});
