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
const SOURCE_B = "source-calendar-b";
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

const buildCalendar = (
  sourceCalendarId: string,
  shifted: number,
  quiescent: number,
) => {
  const events: MaterializedSyncableEvent[] = [];
  const mappings: TwoWayEventMapping[] = [];
  const remoteEvents: RemoteEvent[] = [];
  for (let index = 0; index < shifted; index += 1) {
    const event = createLocalEvent(`${sourceCalendarId}-shifted-${index}`, sourceCalendarId);
    const mapping = createMapping(event);
    events.push(event);
    mappings.push(mapping);
    remoteEvents.push(createShiftedRemoteEvent(mapping, event));
  }
  for (let index = 0; index < quiescent; index += 1) {
    const event = createLocalEvent(`${sourceCalendarId}-quiet-${index}`, sourceCalendarId);
    const mapping = createMapping(event);
    events.push(event);
    mappings.push(mapping);
    remoteEvents.push(createQuiescentRemoteEvent(mapping, event));
  }
  return { events, mappings, remoteEvents };
};

const createScope = (
  policies: [string, WriteBackPolicy][],
): TwoWayReconciliationScope => ({
  authoritativeWindow: TEST_WINDOW,
  requestedWindow: TEST_WINDOW,
  writeBackPolicies: new Map(policies),
});

const classifyTwoCalendars = (shiftedEach: number) => {
  const quiescentEach = 150;
  const first = buildCalendar(SOURCE_A, shiftedEach, quiescentEach);
  const second = buildCalendar(SOURCE_B, shiftedEach, quiescentEach);
  return classifyInboundChanges({
    existingMappings: [...first.mappings, ...second.mappings],
    localEvents: [...first.events, ...second.events],
    now: NOW,
    remoteEvents: [...first.remoteEvents, ...second.remoteEvents],
    remoteRawItemCount: first.remoteEvents.length + second.remoteEvents.length,
    scope: createScope([
      [SOURCE_A, createPolicy(SOURCE_A)],
      [SOURCE_B, createPolicy(SOURCE_B)],
    ]),
  });
};

const writeBacksIn =(result: { classifications: { type: string }[] }) =>
  result.classifications.filter((classification) => classification.type === "write-back");

/*
 * The ceiling is counted on the receiving calendar, across every source calendar copied
 * into it, and not per source calendar: a batch spread thinly across several calendars is
 * the same event it exists to catch, and a per-calendar count would let ten unexplained
 * mutations per calendar reach as many real calendars as the destination has sources.
 * That scope is what the dashboard sentence and the docs now state, so it is pinned here:
 * a change that made this file's first case pass would be a change that made the
 * disclosure wrong again.
 */
describe("the batch ceiling is counted across the calendars sharing a destination", () => {
  it("holds both calendars when six edits on each add up past the ceiling", () => {
    const shiftedEach = 6;
    expect(shiftedEach * 2).toBeGreaterThan(TWO_WAY_EDIT_ABSOLUTE_CEILING);

    const result = classifyTwoCalendars(shiftedEach);

    expect(writeBacksIn(result)).toEqual([]);
    expect(result.counters.editBreakerTripped).toBe(1);
    expect(result.writeBackHold?.sourceCalendarIds).toEqual([SOURCE_A, SOURCE_B]);
  });

  it("writes back a handful of edits on each calendar", () => {
    const result = classifyTwoCalendars(2);

    expect(result.writeBackHold).toBeNull();
    expect(writeBacksIn(result)).toHaveLength(4);
  });

  it("still holds a calendar that moved past the ceiling on its own", () => {
    const result = classifyTwoCalendars(TWO_WAY_EDIT_ABSOLUTE_CEILING + 1);

    expect(writeBacksIn(result)).toEqual([]);
    expect(result.counters.editBreakerTripped).toBe(1);
  });
});
