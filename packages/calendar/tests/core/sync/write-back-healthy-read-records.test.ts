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
const NO_ITEMS = 0;
const ONE_ITEM = 1;

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
};

type TwoWayReconciliationScope = ReconciliationScope & {
  writeBackPolicies: ReadonlyMap<string, WriteBackPolicy>;
};

const createPolicy = (): WriteBackPolicy => ({
  deleteApproved: false,
  destinationCalendarId: DESTINATION_CALENDAR_ID,
  excludeEventDescription: false,
  excludeEventLocation: false,
  excludeEventName: false,
  paused: false,
  sourceCalendarId: SOURCE_CALENDAR_ID,
  writeBackMode: "edits_and_deletes",
});

const createLocalEvent = (): MaterializedSyncableEvent => ({
  availability: "busy",
  calendarId: SOURCE_CALENDAR_ID,
  calendarName: "Personal",
  calendarUrl: null,
  description: "Bring the notes",
  endTime: END_TIME,
  eventStateId: "event-1",
  id: "event-1",
  location: "Room 4",
  sourceEventUid: "source-event-uid-1",
  startTime: START_TIME,
  summary: "Quarterly review",
});

const createMapping = (event: MaterializedSyncableEvent): TwoWayEventMapping => ({
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier: "destination-delete-id",
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
  eventStateId: event.id,
  id: "mapping-1",
  missingFirstObservedAt: null,
  missingObservationCount: 0,
  recurrenceId: null,
  recurrenceRule: null,
  sourceCalendarId: SOURCE_CALENDAR_ID,
  startTime: event.startTime,
  syncEventHash: createSyncEventContentHash(event),
  syncEventId: event.id,
});

const createRemoteEvent = (
  mapping: TwoWayEventMapping,
  event: MaterializedSyncableEvent,
): RemoteEvent => ({
  deleteId: mapping.deleteIdentifier,
  editableAvailability: "busy",
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
  writeBackPolicies: new Map([[SOURCE_CALENDAR_ID, createPolicy()]]),
});

const classify = (input: { rawItemCount: number; remoteEvents: RemoteEvent[] }) => {
  const event = createLocalEvent();
  const mapping = createMapping(event);
  return classifyInboundChanges({
    existingMappings: [mapping],
    localEvents: [event],
    now: NOW,
    remoteEvents: input.remoteEvents,
    remoteRawItemCount: input.rawItemCount,
    scope: createScope(),
  });
};

/*
 * "Delete the originals" is only ever asked after a read that returned nothing at all, and
 * the answer authorises real deletions on a real calendar. A blank read cannot tell an
 * emptied destination from a broken connection, so the answer is not offered until a read
 * that returned something has landed since the copies went missing. That fact has to be
 * observable to be recorded, and today the classifier keeps it entirely to itself.
 */
describe("a read that returned something says so", () => {
  it("reports the source calendars a healthy read covered", () => {
    const event = createLocalEvent();
    const mapping = createMapping(event);

    const result = classify({
      rawItemCount: ONE_ITEM,
      remoteEvents: [createRemoteEvent(mapping, event)],
    });

    expect(result.readHealth).toBe("healthy");
    expect(result.healthyReadSourceCalendarIds).toEqual([SOURCE_CALENDAR_ID]);
  });

  it("reports nothing when the read returned nothing at all", () => {
    const result = classify({ rawItemCount: NO_ITEMS, remoteEvents: [] });

    expect(result.readHealth).toBe("ambiguous_empty");
    expect(result.healthyReadSourceCalendarIds).toEqual([]);
  });

  /*
   * A listing that carried items but none of them ours is a calendar that is alive and
   * emptied of copies. It is not the ambiguous case, but it is also not evidence the
   * copies are still readable, so it clears nothing.
   */
  it("reports nothing when the listing carried items but no copies", () => {
    const result = classify({ rawItemCount: ONE_ITEM, remoteEvents: [] });

    expect(result.readHealth).toBe("live_empty");
    expect(result.healthyReadSourceCalendarIds).toEqual([]);
  });
});
