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
const MOVED_START_TIME = new Date("2027-05-11T15:00:00.000Z");
const MOVED_END_TIME = new Date("2027-05-11T16:00:00.000Z");
const NOW = new Date("2027-05-01T12:00:00.000Z");
const ONE_REPAIR = 1;
const HIDDEN_NAME = "Dentist, Dr Weber";

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

const createLocalEvent = (): MaterializedSyncableEvent => ({
  availability: "oof",
  calendarId: SOURCE_CALENDAR_ID,
  calendarName: "Personal",
  calendarUrl: null,
  description: "Away from the office",
  endTime: END_TIME,
  eventStateId: "event-state-id-1",
  id: "event-state-id-1",
  location: "",
  sourceEventUid: "source-event-uid-1",
  startTime: START_TIME,
  summary: "Out of office",
});

const createMapping = (event: MaterializedSyncableEvent): TwoWayEventMapping => ({
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier: "destination-delete-id-1",
  destinationAvailability: "busy",
  destinationContentHash: createEditableEventContentHash(event),
  destinationDescription: normalizeText(event.description),
  destinationEndTime: event.endTime,
  destinationEventUid: "destination-uid-1",
  destinationIsAllDay: resolveIsAllDayEvent({
    endTime: event.endTime,
    startTime: event.startTime,
  }),
  destinationLocation: normalizeText(event.location),
  destinationStartTime: event.startTime,
  destinationSummary: normalizeText(event.summary),
  endTime: event.endTime,
  eventStateId: event.eventStateId ?? event.id,
  id: "mapping-id-1",
  sourceCalendarId: event.calendarId,
  startTime: event.startTime,
  syncEventHash: createSyncEventContentHash(event),
  syncEventId: event.id,
});

/*
 * The user dragged the copy an hour later and flipped it to free in the same sitting: one
 * axis write-back can carry, one it never can.
 */
const createMovedAndFreedRemoteEvent = (
  mapping: TwoWayEventMapping,
  event: MaterializedSyncableEvent,
): RemoteEvent => ({
  deleteId: mapping.deleteIdentifier,
  editableAvailability: "free",
  editableContentHash: createEditableEventContentHash(event),
  editableFields: {
    description: event.description ?? "",
    isAllDay: false,
    location: event.location ?? "",
    summary: event.summary,
  },
  endTime: MOVED_END_TIME,
  isKeeperEvent: true,
  startTime: MOVED_START_TIME,
  supportedAvailabilities: ["busy", "free"],
  uid: mapping.destinationEventUid,
});

/*
 * The pair hides event names, so the copy carries a placeholder. The user renamed the copy
 * to the real thing and nudged its time: the rename can never reach the source.
 */
const createRenamedAndMovedRemoteEvent = (mapping: TwoWayEventMapping): RemoteEvent => ({
  deleteId: mapping.deleteIdentifier,
  editableAvailability: "busy",
  editableContentHash: createEditableEventContentHash({
    description: "",
    endTime: MOVED_END_TIME,
    location: "",
    startTime: MOVED_START_TIME,
    summary: HIDDEN_NAME,
  }),
  editableFields: {
    description: "",
    isAllDay: false,
    location: "",
    summary: HIDDEN_NAME,
  },
  endTime: MOVED_END_TIME,
  isKeeperEvent: true,
  startTime: MOVED_START_TIME,
  supportedAvailabilities: ["busy", "free"],
  uid: mapping.destinationEventUid,
});

const createScope = (
  writeBackMode: WriteBackPolicy["writeBackMode"],
  excludeEventName = false,
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
      excludeEventName,
      paused: false,
      sourceCalendarId: SOURCE_CALENDAR_ID,
      writeBackMode,
    }]]),
  };
};

/*
 * Both shapes end up as the recorded witness: an adopt-baseline carries it as a mapping
 * update, and a write-back's `observed` is what the applier writes into the destination*
 * columns once the payload lands.
 */
interface RecordedWitness {
  availability: unknown;
  summary: unknown;
}

const collectRecordedWitnesses = (
  classifications: readonly unknown[],
): RecordedWitness[] =>
  classifications.flatMap((classification): RecordedWitness[] => {
    const candidate = classification as {
      mappingUpdate?: { destinationAvailability?: unknown; destinationSummary?: unknown } | null;
      observed?: { availability?: unknown; summary?: unknown } | null;
      type: string;
    };
    if (candidate.mappingUpdate) {
      return [{
        availability: candidate.mappingUpdate.destinationAvailability,
        summary: candidate.mappingUpdate.destinationSummary,
      }];
    }
    if (candidate.type === "write-back" && candidate.observed) {
      return [{
        availability: candidate.observed.availability,
        summary: candidate.observed.summary,
      }];
    }
    return [];
  });

describe("a copy edited on one axis write-back carries and one it cannot", () => {
  it("is repaired under one-way sync", () => {
    const event = createLocalEvent();
    const mapping = createMapping(event);
    const remoteEvent = createMovedAndFreedRemoteEvent(mapping, event);

    const { operations } = computeSyncOperations(
      [event],
      [mapping],
      [remoteEvent],
      createScope("off"),
    );

    expect(operations.filter(({ type }) => type === "replace")).toHaveLength(ONE_REPAIR);
  });

  it("does not record the destination's free as the new availability witness", () => {
    const event = createLocalEvent();
    const mapping = createMapping(event);
    const remoteEvent = createMovedAndFreedRemoteEvent(mapping, event);

    const result = classifyInboundChanges({
      existingMappings: [mapping],
      localEvents: [event],
      now: NOW,
      remoteEvents: [remoteEvent],
      remoteRawItemCount: 1,
      scope: createScope("edits"),
    });

    const witnesses = collectRecordedWitnesses(result.classifications);
    expect(witnesses.map(({ availability }) => availability))
      .not.toContain("free");
  });

  it("does not record a hidden name the user typed on the copy as the witness", () => {
    const event = createLocalEvent();
    const mapping = createMapping(event);
    const remoteEvent = createRenamedAndMovedRemoteEvent(mapping);

    const result = classifyInboundChanges({
      existingMappings: [mapping],
      localEvents: [event],
      now: NOW,
      remoteEvents: [remoteEvent],
      remoteRawItemCount: 1,
      scope: createScope("edits", true),
    });

    const witnesses = collectRecordedWitnesses(result.classifications);
    expect(witnesses.map(({ summary }) => summary))
      .not.toContain(HIDDEN_NAME);
  });
});
