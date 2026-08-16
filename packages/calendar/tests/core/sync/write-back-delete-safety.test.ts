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
  writeBackEpoch: number;
  writeBackEpochWindowStart: Date | null;
};

type TwoWayReconciliationScope = ReconciliationScope & {
  writeBackPolicies: ReadonlyMap<string, WriteBackPolicy>;
};

const createPolicy = (
  sourceCalendarId: string,
  overrides: Partial<WriteBackPolicy> = {},
): WriteBackPolicy => ({
  deleteApproved: false,
  destinationCalendarId: DESTINATION_CALENDAR_ID,
  excludeEventDescription: false,
  excludeEventLocation: false,
  excludeEventName: false,
  paused: false,
  sourceCalendarId,
  writeBackMode: "edits_and_deletes",
  ...overrides,
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

interface Pair {
  events: MaterializedSyncableEvent[];
  mappings: TwoWayEventMapping[];
}

const createLongMissingPair = (
  sourceCalendarId: string,
  count: number,
  prefix: string,
): Pair => {
  const events: MaterializedSyncableEvent[] = [];
  const mappings: TwoWayEventMapping[] = [];
  for (let index = 0; index < count; index += 1) {
    const event = createLocalEvent(`${prefix}-${index}`, sourceCalendarId);
    events.push(event);
    mappings.push(createMapping(event, {
      missingFirstObservedAt: LONG_GONE,
      missingObservationCount: 2,
    }));
  }
  return { events, mappings };
};

const createScope = (
  policies: [string, WriteBackPolicy][],
): TwoWayReconciliationScope => ({
  authoritativeWindow: TEST_WINDOW,
  requestedWindow: TEST_WINDOW,
  writeBackPolicies: new Map(policies),
});

const deletesFor = (
  result: { classifications: { mappingId: string; type: string }[] },
  mappings: TwoWayEventMapping[],
): string[] => {
  const ids = new Set(mappings.map((mapping) => mapping.id));
  return result.classifications
    .filter((classification) =>
      classification.type === "delete" && ids.has(classification.mappingId))
    .map((classification) => classification.mappingId);
};

describe("a delete approval belongs to the source calendar it was given for", () => {
  it("still holds a read that returned nothing at all for the unapproved pair", () => {
    const approved = createLongMissingPair(SOURCE_A, 20, "a");
    const unapproved = createLongMissingPair(SOURCE_B, 3, "b");

    const result = classifyInboundChanges({
      existingMappings: [...approved.mappings, ...unapproved.mappings],
      localEvents: [...approved.events, ...unapproved.events],
      now: NOW,
      remoteEvents: [],
      remoteRawItemCount: 0,
      scope: createScope([
        [SOURCE_A, createPolicy(SOURCE_A, {
          deleteApproved: true,
          deleteApprovedAt: NOW,
        })],
        [SOURCE_B, createPolicy(SOURCE_B)],
      ]),
    });

    expect(result.readHealth).toBe("ambiguous_empty");
    expect(deletesFor(result, unapproved.mappings)).toEqual([]);
    expect(result.suppressedMappingIds).toEqual(
      expect.arrayContaining(unapproved.mappings.map((mapping) => mapping.id)),
    );
    expect(result.deleteConfirmation?.sourceCalendarIds).toEqual([SOURCE_B]);
  });

  it("still lets the approved pair through the same read", () => {
    const approved = createLongMissingPair(SOURCE_A, 20, "a");
    const unapproved = createLongMissingPair(SOURCE_B, 3, "b");

    const result = classifyInboundChanges({
      existingMappings: [...approved.mappings, ...unapproved.mappings],
      localEvents: [...approved.events, ...unapproved.events],
      now: NOW,
      remoteEvents: [],
      remoteRawItemCount: 0,
      scope: createScope([
        [SOURCE_A, createPolicy(SOURCE_A, {
          deleteApproved: true,
          deleteApprovedAt: NOW,
        })],
        [SOURCE_B, createPolicy(SOURCE_B)],
      ]),
    });

    expect(deletesFor(result, approved.mappings)).toHaveLength(20);
  });
});

describe("the bulk-delete breaker is scoped to the source calendar losing its copies", () => {
  it("trips when every copy of one source calendar vanishes beside a large healthy one", () => {
    const healthy: Pair = { events: [], mappings: [] };
    const remoteEvents: RemoteEvent[] = [];
    for (let index = 0; index < 100; index += 1) {
      const event = createLocalEvent(`healthy-${index}`, SOURCE_A);
      const mapping = createMapping(event);
      healthy.events.push(event);
      healthy.mappings.push(mapping);
      remoteEvents.push(createRemoteEvent(mapping, event));
    }
    const vanished = createLongMissingPair(SOURCE_B, 20, "gone");

    const result = classifyInboundChanges({
      existingMappings: [...healthy.mappings, ...vanished.mappings],
      localEvents: [...healthy.events, ...vanished.events],
      now: NOW,
      remoteEvents,
      remoteRawItemCount: remoteEvents.length,
      scope: createScope([
        [SOURCE_A, createPolicy(SOURCE_A)],
        [SOURCE_B, createPolicy(SOURCE_B)],
      ]),
    });

    expect(result.readHealth).toBe("healthy");
    expect(result.deleteBreakerTripped).toBe(true);
    expect(deletesFor(result, vanished.mappings)).toEqual([]);
    expect(result.deleteConfirmation).toEqual({
      reason: "delete_breaker_tripped",
      sourceCalendarIds: [SOURCE_B],
    });
  });
});

describe("a copy Keeper has never observed alive is not evidence the user deleted it", () => {
  const createUnwitnessedMapping = (
    overrides: Partial<TwoWayEventMapping> = {},
  ): { event: MaterializedSyncableEvent; mapping: TwoWayEventMapping } => {
    const event = createLocalEvent("fresh-enable", SOURCE_A);
    return {
      event,
      mapping: createMapping(event, {
        destinationAvailability: null,
        destinationContentHash: null,
        destinationDescription: null,
        destinationEndTime: null,
        destinationIsAllDay: null,
        destinationLocation: null,
        destinationStartTime: null,
        destinationSummary: null,
        ...overrides,
      }),
    };
  };

  const classify = (
    event: MaterializedSyncableEvent,
    mapping: TwoWayEventMapping,
  ) => classifyInboundChanges({
    existingMappings: [mapping],
    localEvents: [event],
    now: NOW,
    remoteEvents: [],
    remoteRawItemCount: 4,
    scope: createScope([[SOURCE_A, createPolicy(SOURCE_A)]]),
  });

  it("does not start a delete clock on the pass that first enabled write-back", () => {
    const { event, mapping } = createUnwitnessedMapping();
    const result = classify(event, mapping);

    expect(result.classifications.map((classification) => classification.type))
      .not.toContain("delete-candidate");
    expect(result.suppressedMappingIds).toEqual([]);
  });

  it("does not delete off a stale clock carried across a mode change", () => {
    const { event, mapping } = createUnwitnessedMapping({
      missingFirstObservedAt: LONG_GONE,
      missingObservationCount: 2,
    });
    const result = classify(event, mapping);

    expect(result.classifications.map((classification) => classification.type))
      .not.toContain("delete");
    expect(result.suppressedMappingIds).toEqual([]);
  });
});
