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
} from "../../../src/core/types";

const DESTINATION_CALENDAR_ID = "destination-calendar-id";
const SOURCE_CALENDAR_ID = "source-calendar-id";
const START_TIME = new Date("2027-05-11T14:00:00.000Z");
const END_TIME = new Date("2027-05-11T15:00:00.000Z");
const NOW = new Date("2027-05-01T12:00:00.000Z");
const COPY_COUNT = 3;

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
  writeBackMode: "edits",
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

const WITNESS_CLEARED = {
  destinationAvailability: null,
  destinationContentHash: null,
  destinationDescription: null,
  destinationEndTime: null,
  destinationIsAllDay: null,
  destinationLocation: null,
  destinationStartTime: null,
  destinationSummary: null,
} as const;

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

const classifyEmptyRead = (pair: Pair, policy: WriteBackPolicy) =>
  classifyInboundChanges({
    existingMappings: pair.mappings,
    localEvents: pair.events,
    now: NOW,
    remoteEvents: [],
    remoteRawItemCount: 0,
    scope: createScope(policy),
  });

const rebuildOperations = (
  pair: Pair,
  policy: WriteBackPolicy,
  suppressedMappingIds: string[],
) =>
  computeSyncOperations(
    pair.events,
    pair.mappings,
    [],
    createScope(policy),
    new Set(suppressedMappingIds),
  );

describe("a read that returned nothing at all holds only what it protects", () => {
  it("does not hold an edits-only pair, which can never delete a source event", () => {
    const policy = createPolicy();
    const result = classifyEmptyRead(createPair(), policy);

    expect(result.readHealth).toBe("ambiguous_empty");
    expect(result.suppressedMappingIds).toEqual([]);
    expect(result.classifications.filter(({ type }) => type === "delete")).toEqual([]);
  });

  it("re-creates the copies an edits-only pair lost", () => {
    const policy = createPolicy();
    const pair = createPair();
    const result = classifyEmptyRead(pair, policy);
    const { operations } = rebuildOperations(pair, policy, result.suppressedMappingIds);

    expect(operations.filter(({ type }) => type === "add" || type === "replace"))
      .toHaveLength(COPY_COUNT);
  });

  it("does not hold a pair whose copies it has never observed alive", () => {
    const policy = createPolicy({ writeBackMode: "edits_and_deletes" });
    const pair = createPair(WITNESS_CLEARED);
    const result = classifyEmptyRead(pair, policy);
    const { operations } = rebuildOperations(pair, policy, result.suppressedMappingIds);

    expect(result.suppressedMappingIds).toEqual([]);
    expect(result.classifications.filter(({ type }) => type === "delete")).toEqual([]);
    expect(operations.filter(({ type }) => type === "add" || type === "replace"))
      .toHaveLength(COPY_COUNT);
  });

  it("still holds a deleting pair whose copies it did observe alive", () => {
    const policy = createPolicy({ writeBackMode: "edits_and_deletes" });
    const pair = createPair();
    const result = classifyEmptyRead(pair, policy);

    expect(result.suppressedMappingIds)
      .toEqual(pair.mappings.map((mapping) => mapping.id));
    expect(result.classifications.filter(({ type }) => type === "delete")).toEqual([]);
    expect(result.deleteConfirmation).toEqual({
      reason: "all_copies_missing",
      sourceCalendarIds: [SOURCE_CALENDAR_ID],
    });
  });
});
