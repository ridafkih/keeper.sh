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

/*
 * Out of office on the source. Google and CalDAV cannot hold it, so the copy is pushed as a
 * plain busy block: the clamp is what makes the recorded witness "busy" rather than "oof".
 */
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
 * Only the availability moved, and the destination advertises no "oof" of its own, so the
 * rejection is a clamp rather than an outright unwritable axis.
 */
const createFreedRemoteEvent = (
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
  endTime: mapping.endTime,
  isKeeperEvent: true,
  startTime: mapping.startTime,
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

describe("a clamped out-of-office copy flipped to free", () => {
  it("is repaired under one-way sync", () => {
    const event = createLocalEvent();
    const mapping = createMapping(event);
    const remoteEvent = createFreedRemoteEvent(mapping, event);

    const { operations } = computeSyncOperations(
      [event],
      [mapping],
      [remoteEvent],
      createScope("off"),
    );

    expect(operations.filter(({ type }) => type === "replace")).toHaveLength(ONE_REPAIR);
  });

  it("is repaired under two-way sync as well", () => {
    const event = createLocalEvent();
    const mapping = createMapping(event);
    const remoteEvent = createFreedRemoteEvent(mapping, event);
    const scope = createScope("edits");

    const result = classifyInboundChanges({
      existingMappings: [mapping],
      localEvents: [event],
      now: NOW,
      remoteEvents: [remoteEvent],
      remoteRawItemCount: 1,
      scope,
    });

    expect(result.counters.blockedAvailability).toBe(1);

    const adopted = result.classifications.flatMap((classification) => {
      if (!("mappingUpdate" in classification) || !classification.mappingUpdate) {
        return [];
      }
      return [classification.mappingUpdate];
    });
    expect(adopted.map(({ destinationAvailability }) => destinationAvailability))
      .not.toContain("free");
    expect(result.suppressedMappingIds).toEqual([]);

    const { operations } = computeSyncOperations(
      [event],
      [mapping],
      [remoteEvent],
      scope,
      new Set(result.suppressedMappingIds),
    );
    expect(operations.filter(({ type }) => type === "replace")).toHaveLength(ONE_REPAIR);
  });
});
