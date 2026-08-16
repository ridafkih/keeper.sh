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
} from "../../../src/core/types";

const DESTINATION_CALENDAR_ID = "destination-calendar-id";
const SOURCE_CALENDAR_ID = "source-calendar-id";
const START_TIME = new Date("2027-05-11T14:00:00.000Z");
const END_TIME = new Date("2027-05-11T15:00:00.000Z");
const NOW = new Date("2027-05-01T12:00:00.000Z");
const MINUTE_MS = 60_000;
const APPROVED_AT = new Date(NOW.getTime() - 23 * MINUTE_MS);
const MISSING_BEFORE_APPROVAL = new Date(NOW.getTime() - 40 * MINUTE_MS);
const MISSING_AFTER_APPROVAL = new Date(NOW.getTime() - 11 * MINUTE_MS);
const COPY_COUNT = 4;
const SECOND_OBSERVATION = 2;

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
  ...overrides,
});

interface Pair {
  events: MaterializedSyncableEvent[];
  mappings: TwoWayEventMapping[];
}

const createPair = (overrides: Partial<TwoWayEventMapping> = {}): Pair => {
  const events: MaterializedSyncableEvent[] = [];
  const mappings: TwoWayEventMapping[] = [];
  for (let index = 0; index < COPY_COUNT; index += 1) {
    const event = createLocalEvent(`event-${index}`);
    events.push(event);
    mappings.push(createMapping(event, overrides));
  }
  return { events, mappings };
};

const createScope = (policy: WriteBackPolicy): TwoWayReconciliationScope => ({
  authoritativeWindow: TEST_WINDOW,
  requestedWindow: TEST_WINDOW,
  writeBackPolicies: new Map([[SOURCE_CALENDAR_ID, policy]]),
});

const classifyBlankRead = (pair: Pair, policy: WriteBackPolicy) =>
  classifyInboundChanges({
    existingMappings: pair.mappings,
    localEvents: pair.events,
    now: NOW,
    remoteEvents: [],
    remoteRawItemCount: 0,
    scope: createScope(policy),
  });

describe("a delete approval covers the disappearance it was asked about", () => {
  it("still deletes copies that were already missing when the answer was given", () => {
    const pair = createPair({
      missingFirstObservedAt: MISSING_BEFORE_APPROVAL,
      missingObservationCount: SECOND_OBSERVATION,
    });
    const result = classifyBlankRead(
      pair,
      createPolicy({ deleteApproved: true, deleteApprovedAt: APPROVED_AT }),
    );

    expect(result.readHealth).toBe("ambiguous_empty");
    expect(result.classifications.filter(({ type }) => type === "delete"))
      .toHaveLength(COPY_COUNT);
  });

  it("holds copies that only went missing after the answer was given", () => {
    const pair = createPair({
      missingFirstObservedAt: MISSING_AFTER_APPROVAL,
      missingObservationCount: SECOND_OBSERVATION,
    });
    const result = classifyBlankRead(
      pair,
      createPolicy({ deleteApproved: true, deleteApprovedAt: APPROVED_AT }),
    );

    expect(result.readHealth).toBe("ambiguous_empty");
    expect(result.classifications.filter(({ type }) => type === "delete"))
      .toEqual([]);
    expect(result.suppressedMappingIds)
      .toEqual(pair.mappings.map((mapping) => mapping.id));
    expect(result.deleteConfirmation).toEqual({
      reason: "all_copies_missing",
      sourceCalendarIds: [SOURCE_CALENDAR_ID],
    });
  });

  it("holds copies whose disappearance no approval timestamp covers", () => {
    const pair = createPair({
      missingFirstObservedAt: MISSING_BEFORE_APPROVAL,
      missingObservationCount: SECOND_OBSERVATION,
    });
    const result = classifyBlankRead(
      pair,
      createPolicy({ deleteApproved: true, deleteApprovedAt: null }),
    );

    expect(result.classifications.filter(({ type }) => type === "delete"))
      .toEqual([]);
  });
});

describe("a held read still records what it saw", () => {
  it("advances the delete clock of every copy it withheld", () => {
    const pair = createPair();
    const result = classifyBlankRead(pair, createPolicy());

    expect(result.classifications.filter(({ type }) => type === "delete"))
      .toEqual([]);
    expect(
      result.classifications
        .filter(({ type }) => type === "delete-candidate")
        .map((classification) => classification.mappingId),
    ).toEqual(pair.mappings.map((mapping) => mapping.id));
  });

  it("lets a later approval cover a disappearance the hold recorded", () => {
    const pair = createPair();
    const held = classifyBlankRead(pair, createPolicy());
    const recorded = new Map(
      held.classifications
        .filter((classification) => classification.type === "delete-candidate")
        .map((classification) => [
          classification.mappingUpdate.id,
          classification.mappingUpdate,
        ] as const),
    );
    const answered: Pair = {
      events: pair.events,
      mappings: pair.mappings.map((mapping) => ({
        ...mapping,
        missingFirstObservedAt:
          recorded.get(mapping.id)?.missingFirstObservedAt ?? null,
        missingObservationCount: SECOND_OBSERVATION,
      })),
    };
    const later = new Date(NOW.getTime() + 20 * MINUTE_MS);
    const result = classifyInboundChanges({
      existingMappings: answered.mappings,
      localEvents: answered.events,
      now: later,
      remoteEvents: [],
      remoteRawItemCount: 0,
      scope: createScope(createPolicy({
        deleteApproved: true,
        deleteApprovedAt: new Date(NOW.getTime() + MINUTE_MS),
      })),
    });

    expect(result.classifications.filter(({ type }) => type === "delete"))
      .toHaveLength(COPY_COUNT);
  });
});
