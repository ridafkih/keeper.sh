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
const SOURCE_CALENDAR_ID = "source-calendar-id";
const START_TIME = new Date("2027-05-11T14:00:00.000Z");
const END_TIME = new Date("2027-05-11T15:00:00.000Z");
const NOW = new Date("2027-05-01T12:00:00.000Z");
const ONE_MINUTE_MS = 60_000;
const ELEVEN_MINUTES_MS = 11 * ONE_MINUTE_MS;
const FIRST_ABSENCE = new Date(NOW.getTime() - ELEVEN_MINUTES_MS);
const NEXT_PASS = new Date(NOW.getTime() + ONE_MINUTE_MS);
const NO_OBSERVATIONS = 0;

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
};

type TwoWayReconciliationScope = ReconciliationScope & {
  writeBackPolicies?: ReadonlyMap<string, WriteBackPolicy>;
};

const createLocalEvent = (): MaterializedSyncableEvent => ({
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
});

/*
 * A copy that vanished from one earlier listing: the delete clock is already running and
 * one absence is already recorded against it.
 */
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
  missingFirstObservedAt: FIRST_ABSENCE,
  missingObservationCount: 1,
  sourceCalendarId: event.calendarId,
  startTime: event.startTime,
  syncEventHash: createSyncEventContentHash(event),
  syncEventId: event.id,
});

/*
 * The copy answers this listing, alive, with only its availability flipped to free —
 * the one axis no write-back payload carries.
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

const createScope = (): TwoWayReconciliationScope => ({
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
    writeBackMode: "edits_and_deletes",
  }]]),
});

const collectMappingUpdates = (
  classifications: readonly unknown[],
): { missingFirstObservedAt?: Date | null; missingObservationCount?: number }[] =>
  classifications.flatMap((classification) => {
    const update = (classification as { mappingUpdate?: unknown }).mappingUpdate;
    if (!update) {
      return [];
    }
    return [update as { missingFirstObservedAt?: Date | null; missingObservationCount?: number }];
  });

describe("a delete clock that survives a listing the copy answered", () => {
  it("clears the pending delete state when the copy answers the listing", () => {
    const event = createLocalEvent();
    const mapping = createMapping(event);

    const result = classifyInboundChanges({
      existingMappings: [mapping],
      localEvents: [event],
      now: NOW,
      remoteEvents: [createFreedRemoteEvent(mapping, event)],
      remoteRawItemCount: 1,
      scope: createScope(),
    });

    const cleared = collectMappingUpdates(result.classifications)
      .filter((update) => update.missingObservationCount === NO_OBSERVATIONS
        && update.missingFirstObservedAt === null);
    expect(cleared).toHaveLength(1);
  });

  it("does not delete the original on the first listing that omits the copy again", () => {
    const event = createLocalEvent();
    const mapping = createMapping(event);

    const present = classifyInboundChanges({
      existingMappings: [mapping],
      localEvents: [event],
      now: NOW,
      remoteEvents: [createFreedRemoteEvent(mapping, event)],
      remoteRawItemCount: 1,
      scope: createScope(),
    });

    const [update] = collectMappingUpdates(present.classifications);
    const flushed: TwoWayEventMapping = {
      ...mapping,
      ...update,
      id: mapping.id,
    };

    const absent = classifyInboundChanges({
      existingMappings: [flushed],
      localEvents: [event],
      now: NEXT_PASS,
      remoteEvents: [],
      remoteRawItemCount: 3,
      scope: createScope(),
    });

    expect(absent.classifications.map(({ type }) => type)).not.toContain("delete");
  });
});
