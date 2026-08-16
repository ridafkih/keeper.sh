import { TWO_WAY_EDIT_ABSOLUTE_CEILING } from "@keeper.sh/constants";
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
const HOUR_MS = 3_600_000;
const NOW = new Date("2027-05-01T12:00:00.000Z");

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
  writeBackMode: "edits",
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

const createMapping = (event: MaterializedSyncableEvent): TwoWayEventMapping => ({
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
});

const createShiftedRemoteEvent = (
  mapping: TwoWayEventMapping,
  event: MaterializedSyncableEvent,
): RemoteEvent => ({
  deleteId: mapping.deleteIdentifier,
  editableAvailability: "busy",
  editableContentHash: createEditableEventContentHash(event),
  editableFields: {
    description: event.description,
    isAllDay: false,
    location: event.location,
    summary: event.summary,
  },
  endTime: new Date(END_TIME.getTime() + HOUR_MS),
  isKeeperEvent: true,
  startTime: new Date(START_TIME.getTime() + HOUR_MS),
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

const createQuiescentRemoteEvent = (
  mapping: TwoWayEventMapping,
  event: MaterializedSyncableEvent,
): RemoteEvent => ({
  deleteId: mapping.deleteIdentifier,
  editableAvailability: "busy",
  editableContentHash: createEditableEventContentHash(event),
  editableFields: {
    description: event.description,
    isAllDay: false,
    location: event.location,
    summary: event.summary,
  },
  endTime: END_TIME,
  isKeeperEvent: true,
  startTime: START_TIME,
  supportedAvailabilities: ["busy", "free"],
  uid: mapping.destinationEventUid,
} as RemoteEvent);

const createMixedCalendar = (shifted: number, quiescent: number) => {
  const events: MaterializedSyncableEvent[] = [];
  const mappings: TwoWayEventMapping[] = [];
  const remoteEvents: RemoteEvent[] = [];
  for (let index = 0; index < shifted; index += 1) {
    const event = createLocalEvent(`shifted-${index}`, SOURCE_A);
    const mapping = createMapping(event);
    events.push(event);
    mappings.push(mapping);
    remoteEvents.push(createShiftedRemoteEvent(mapping, event));
  }
  for (let index = 0; index < quiescent; index += 1) {
    const event = createLocalEvent(`quiet-${index}`, SOURCE_A);
    const mapping = createMapping(event);
    events.push(event);
    mappings.push(mapping);
    remoteEvents.push(createQuiescentRemoteEvent(mapping, event));
  }
  return { events, mappings, remoteEvents };
};

const classifyMixedCalendar = (shifted: number, quiescent: number) => {
  const calendar = createMixedCalendar(shifted, quiescent);
  return classifyInboundChanges({
    existingMappings: calendar.mappings,
    localEvents: calendar.events,
    now: NOW,
    remoteEvents: calendar.remoteEvents,
    remoteRawItemCount: calendar.remoteEvents.length,
    scope: createScope([[SOURCE_A, createPolicy(SOURCE_A)]]),
  });
};

const writeBacksIn = (result: { classifications: { type: string }[] }) =>
  result.classifications.filter((classification) => classification.type === "write-back");

/*
 * The shift that moved a hundred copies is diluted by two hundred copies it did not
 * touch, so no ratio can see it. Nothing else bounds an edit: unlike a deletion it takes
 * no confirmation, no probe, no tombstone and no per-calendar daily cap, and the previous
 * values of a hundred real events are gone the moment it is written.
 */
describe("a sub-majority destination-side shift is held back from the source", () => {
  it("writes nothing to the source when a hundred copies moved together", () => {
    const result = classifyMixedCalendar(100, 200);

    expect(writeBacksIn(result)).toEqual([]);
    expect(result.counters.editBreakerTripped).toBe(1);
    expect(result.writeBackHold).toEqual({
      reason: "bulk_edit_breaker",
      sourceCalendarIds: [SOURCE_A],
    });
  });

  it("still writes back an edit a user made to a handful of copies", () => {
    const result = classifyMixedCalendar(4, 296);

    expect(writeBacksIn(result)).toHaveLength(4);
    expect(result.writeBackHold).toBeNull();
  });

  /*
   * The number the dashboard discloses. One edit past it discards the whole batch rather
   * than the one that crossed the line, so the figure the user is shown has to be the
   * figure the classifier holds at.
   */
  it("writes back every edit at the disclosed ceiling", () => {
    const result = classifyMixedCalendar(TWO_WAY_EDIT_ABSOLUTE_CEILING, 290);

    expect(writeBacksIn(result)).toHaveLength(TWO_WAY_EDIT_ABSOLUTE_CEILING);
    expect(result.writeBackHold).toBeNull();
  });

  it("writes back none of them one edit past the disclosed ceiling", () => {
    const result = classifyMixedCalendar(TWO_WAY_EDIT_ABSOLUTE_CEILING + 1, 289);

    expect(writeBacksIn(result)).toEqual([]);
    expect(result.counters.editBreakerTripped).toBe(1);
    expect(result.writeBackHold).toEqual({
      reason: "bulk_edit_breaker",
      sourceCalendarIds: [SOURCE_A],
    });
  });
});
