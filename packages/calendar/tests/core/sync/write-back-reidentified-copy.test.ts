import { describe, expect, it } from "vitest";
import { classifyInboundChanges } from "../../../src/core/sync/write-back";
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
const SOURCE_A = "source-calendar-a";
const START_TIME = new Date("2027-05-11T14:00:00.000Z");
const END_TIME = new Date("2027-05-11T15:00:00.000Z");
const NOW = new Date("2027-05-01T12:00:00.000Z");
const MINUTE_MS = 60_000;
const GRACE_MS = 10 * MINUTE_MS;
const LONG_GONE = new Date(NOW.getTime() - GRACE_MS - MINUTE_MS);

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
  missingFirstObservedAt: Date | null;
  missingObservationCount: number;
  recurrenceId: Date | null;
  recurrenceRule: string | null;
  writeBackEpoch: number;
  writeBackEpochWindowStart: Date | null;
};

type TwoWayReconciliationScope = ReconciliationScope & {
  writeBackPolicies: ReadonlyMap<string, WriteBackPolicy>;
};

const createPolicy = (sourceCalendarId: string): WriteBackPolicy => ({
  deleteApproved: false,
  destinationCalendarId: DESTINATION_CALENDAR_ID,
  excludeEventDescription: false,
  excludeEventLocation: false,
  excludeEventName: false,
  paused: false,
  sourceCalendarId,
  writeBackMode: "edits_and_deletes",
});

const createLocalEvent = (
  id: string,
  sourceCalendarId: string,
): MaterializedSyncableEvent => ({
  availability: "busy",
  calendarId: sourceCalendarId,
  calendarName: "Personal",
  calendarUrl: null,
  description: "Bring the notes",
  endTime: END_TIME,
  eventStateId: id,
  id,
  location: "Room 4",
  sourceEventUid: `source-event-uid-${id}`,
  startTime: START_TIME,
  summary: "Quarterly review",
});

const createMapping = (
  event: MaterializedSyncableEvent,
  overrides: Partial<TwoWayEventMapping> = {},
): TwoWayEventMapping => ({
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier: `destination-delete-id-${event.id}`,
  destinationAvailability: "busy",
  destinationContentHash: createEditableEventContentHash(event),
  destinationDescription: normalizeText(event.description),
  destinationEndTime: event.endTime,
  destinationEventUid: `destination-uid-${event.id}`,
  destinationIsAllDay: resolveIsAllDayEvent({
    endTime: event.endTime,
    startTime: event.startTime,
  }),
  destinationLocation: normalizeText(event.location),
  destinationStartTime: event.startTime,
  destinationSummary: normalizeText(event.summary),
  endTime: event.endTime,
  eventStateId: event.eventStateId ?? event.id,
  id: `mapping-${event.id}`,
  missingFirstObservedAt: null,
  missingObservationCount: 0,
  recurrenceId: null,
  recurrenceRule: null,
  sourceCalendarId: event.calendarId,
  startTime: event.startTime,
  syncEventHash: createSyncEventContentHash(event),
  syncEventId: event.id,
  writeBackEpoch: 0,
  writeBackEpochWindowStart: null,
  ...overrides,
});

/*
 * The copy the user restored: same iCalUID, a delete identifier the provider reassigned.
 */
const createReidentifiedRemoteEvent = (
  mapping: TwoWayEventMapping,
  event: MaterializedSyncableEvent,
): RemoteEvent => ({
  deleteId: "graph-id-after-the-restore",
  editableAvailability: "busy",
  editableContentHash: createEditableEventContentHash(event),
  editableFields: {
    description: event.description,
    isAllDay: false,
    location: event.location,
    summary: event.summary,
  },
  endTime: mapping.endTime,
  isKeeperEvent: true,
  startTime: mapping.startTime,
  supportedAvailabilities: ["busy", "free"],
  uid: mapping.destinationEventUid,
} as RemoteEvent);

const createScope = (
  policies: [string, WriteBackPolicy][],
): TwoWayReconciliationScope => ({
  authoritativeWindow: TEST_WINDOW,
  requestedWindow: TEST_WINDOW,
  writeBackPolicies: new Map(policies),
});

describe("a copy the destination reidentified is still a copy", () => {
  it("does not delete the original when the same read still carries the copy's uid", () => {
    const event = createLocalEvent("restored", SOURCE_A);
    const mapping = createMapping(event, {
      missingFirstObservedAt: LONG_GONE,
      missingObservationCount: 2,
    });

    const result = classifyInboundChanges({
      existingMappings: [mapping],
      localEvents: [event],
      now: NOW,
      remoteEvents: [createReidentifiedRemoteEvent(mapping, event)],
      remoteRawItemCount: 1,
      scope: createScope([[SOURCE_A, createPolicy(SOURCE_A)]]),
    });

    expect(result.readHealth).toBe("healthy");
    expect(
      result.classifications
        .filter((classification) => classification.type === "delete")
        .map((classification) => classification.mappingId),
    ).toEqual([]);
  });

  it("does not start a delete clock on the pass that reidentified it", () => {
    const event = createLocalEvent("restored-fresh", SOURCE_A);
    const mapping = createMapping(event);

    const result = classifyInboundChanges({
      existingMappings: [mapping],
      localEvents: [event],
      now: NOW,
      remoteEvents: [createReidentifiedRemoteEvent(mapping, event)],
      remoteRawItemCount: 1,
      scope: createScope([[SOURCE_A, createPolicy(SOURCE_A)]]),
    });

    expect(
      result.classifications.filter((classification) =>
        classification.type === "delete-candidate"),
    ).toEqual([]);
    expect(result.suppressedMappingIds).toEqual([]);
  });
});
