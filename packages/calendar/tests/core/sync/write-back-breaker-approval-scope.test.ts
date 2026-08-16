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
const MINUTE_MS = 60_000;
const APPROVED_AT = new Date(NOW.getTime() - 25 * MINUTE_MS);
const MISSING_AFTER_APPROVAL = new Date(NOW.getTime() - 11 * MINUTE_MS);
const COPY_COUNT = 20;
const SECOND_OBSERVATION = 2;
const LIVE_RAW_ITEMS = 30;

const TEST_WINDOW = {
  timeMax: new Date("2100-01-01T00:00:00.000Z"),
  timeMin: new Date("2000-01-01T00:00:00.000Z"),
};

interface WriteBackPolicy {
  deleteApproved: boolean;
  deleteApprovedAt?: Date | null;
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

const createPolicy = (
  overrides: Partial<WriteBackPolicy> = {},
): WriteBackPolicy => ({
  deleteApproved: false,
  destinationCalendarId: DESTINATION_CALENDAR_ID,
  excludeEventDescription: false,
  excludeEventLocation: false,
  excludeEventName: false,
  paused: false,
  sourceCalendarId: SOURCE_CALENDAR_ID,
  writeBackMode: "edits_and_deletes",
  ...overrides,
});

const createLocalEvent = (id: string): MaterializedSyncableEvent => ({
  availability: "busy",
  calendarId: SOURCE_CALENDAR_ID,
  calendarName: "Personal",
  calendarUrl: null,
  description: "Bring the notes",
  endTime: END_TIME,
  eventStateId: id,
  id,
  location: "Room 4",
  sourceEventUid: `source-event-uid-${id}`,
  sourceFields: {
    description: "Bring the notes",
    location: "Room 4",
    title: "Quarterly review",
  },
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
  missingFirstObservedAt: MISSING_AFTER_APPROVAL,
  missingObservationCount: SECOND_OBSERVATION,
  recurrenceId: null,
  recurrenceRule: null,
  sourceCalendarId: event.calendarId,
  startTime: event.startTime,
  syncEventHash: createSyncEventContentHash(event),
  syncEventId: event.id,
  ...overrides,
});

interface Pair {
  events: MaterializedSyncableEvent[];
  mappings: TwoWayEventMapping[];
}

const createPair = (): Pair => {
  const events: MaterializedSyncableEvent[] = [];
  const mappings: TwoWayEventMapping[] = [];
  for (let index = 0; index < COPY_COUNT; index += 1) {
    const event = createLocalEvent(`event-${index}`);
    events.push(event);
    mappings.push(createMapping(event));
  }
  return { events, mappings };
};

const createScope = (policy: WriteBackPolicy): TwoWayReconciliationScope => ({
  authoritativeWindow: TEST_WINDOW,
  requestedWindow: TEST_WINDOW,
  writeBackPolicies: new Map([[SOURCE_CALENDAR_ID, policy]]),
});

/*
 * The destination answered with items — somebody else's events are still in it — so the
 * blank-read hold never applies. The bulk-delete breaker is the only thing standing between
 * twenty vanished copies and twenty destroyed originals.
 */
const classifyLiveRead = (pair: Pair, policy: WriteBackPolicy) =>
  classifyInboundChanges({
    existingMappings: pair.mappings,
    localEvents: pair.events,
    now: NOW,
    remoteEvents: [],
    remoteRawItemCount: LIVE_RAW_ITEMS,
    scope: createScope(policy),
  });

const SURVIVOR_COUNT = 10;

const createRemoteEvent = (
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
  endTime: mapping.endTime,
  isKeeperEvent: true,
  startTime: mapping.startTime,
  supportedAvailabilities: ["busy", "free"],
  uid: mapping.destinationEventUid,
} as RemoteEvent);

/*
 * Ten copies answer the read and twenty are gone: the destination is plainly reachable, so
 * nothing holds and the breaker is the only guard left.
 */
const classifyHealthyRead = (policy: WriteBackPolicy) => {
  const events: MaterializedSyncableEvent[] = [];
  const mappings: TwoWayEventMapping[] = [];
  const remoteEvents: RemoteEvent[] = [];
  for (let index = 0; index < SURVIVOR_COUNT; index += 1) {
    const event = createLocalEvent(`alive-${index}`);
    const mapping = createMapping(event, {
      missingFirstObservedAt: null,
      missingObservationCount: 0,
    });
    events.push(event);
    mappings.push(mapping);
    remoteEvents.push(createRemoteEvent(mapping, event));
  }
  const vanished = createPair();

  return classifyInboundChanges({
    existingMappings: [...mappings, ...vanished.mappings],
    localEvents: [...events, ...vanished.events],
    now: NOW,
    remoteEvents,
    remoteRawItemCount: remoteEvents.length,
    scope: createScope(policy),
  });
};

describe("the bulk-delete breaker and a live delete approval", () => {
  it("trips on a healthy read whose copies vanished without an answer", () => {
    const result = classifyHealthyRead(createPolicy());

    expect(result.readHealth).toBe("healthy");
    expect(result.deleteBreakerTripped).toBe(true);
    expect(result.classifications.filter(({ type }) => type === "delete")).toEqual([]);
  });

  it("still trips on a healthy read when an unrelated answer is live", () => {
    const result = classifyHealthyRead(
      createPolicy({ deleteApproved: true, deleteApprovedAt: APPROVED_AT }),
    );

    expect(result.readHealth).toBe("healthy");
    expect(result.classifications.filter(({ type }) => type === "delete")).toEqual([]);
    expect(result.deleteBreakerTripped).toBe(true);
  });
});

describe("the bulk-delete breaker on a live but copy-less read", () => {
  it("trips for a bulk disappearance nobody was asked about", () => {
    const result = classifyLiveRead(createPair(), createPolicy());

    expect(result.readHealth).toBe("live_empty");
    expect(result.deleteBreakerTripped).toBe(true);
    expect(result.classifications.filter(({ type }) => type === "delete")).toEqual([]);
  });

  it("still trips when an unrelated answer is inside its thirty-minute window", () => {
    const result = classifyLiveRead(
      createPair(),
      createPolicy({ deleteApproved: true, deleteApprovedAt: APPROVED_AT }),
    );

    expect(result.readHealth).toBe("live_empty");
    expect(result.classifications.filter(({ type }) => type === "delete")).toEqual([]);
    expect(result.deleteBreakerTripped).toBe(true);
    expect(result.deleteConfirmation).toEqual({
      reason: "delete_breaker_tripped",
      sourceCalendarIds: [SOURCE_CALENDAR_ID],
    });
  });
});
