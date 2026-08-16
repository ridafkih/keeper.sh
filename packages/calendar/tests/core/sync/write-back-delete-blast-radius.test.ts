import { TWO_WAY_DELETE_ABSOLUTE_CEILING } from "@keeper.sh/constants";
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
const CALENDAR_SIZE = 300;

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

const createScope = (): TwoWayReconciliationScope => ({
  authoritativeWindow: TEST_WINDOW,
  requestedWindow: TEST_WINDOW,
  writeBackPolicies: new Map([[SOURCE_A, createPolicy(SOURCE_A)]]),
});

/*
 * The copies that vanished are long past the grace period and observed missing twice, so
 * every other delete defence has already been satisfied: the breaker is the only thing
 * left between the disappearance and fifty destroyed originals.
 */
const classifyVanished = (vanishedCount: number) => {
  const events: MaterializedSyncableEvent[] = [];
  const mappings: TwoWayEventMapping[] = [];
  const remoteEvents: RemoteEvent[] = [];
  const vanishedMappingIds = new Set<string>();
  for (let index = 0; index < vanishedCount; index += 1) {
    const event = createLocalEvent(`gone-${index}`, SOURCE_A);
    const mapping = createMapping(event, {
      missingFirstObservedAt: LONG_GONE,
      missingObservationCount: 2,
    });
    events.push(event);
    mappings.push(mapping);
    vanishedMappingIds.add(mapping.id);
  }
  for (let index = vanishedCount; index < CALENDAR_SIZE; index += 1) {
    const event = createLocalEvent(`healthy-${index}`, SOURCE_A);
    const mapping = createMapping(event);
    events.push(event);
    mappings.push(mapping);
    remoteEvents.push(createRemoteEvent(mapping, event));
  }

  const result = classifyInboundChanges({
    existingMappings: mappings,
    localEvents: events,
    now: NOW,
    remoteEvents,
    remoteRawItemCount: remoteEvents.length,
    scope: createScope(),
  });

  return {
    deletes: result.classifications.filter((classification) =>
      classification.type === "delete" && vanishedMappingIds.has(classification.mappingId)),
    result,
  };
};

/*
 * A ratio alone cannot see fifty copies vanishing out of three hundred, and fifty
 * originals is exactly what nobody can put back. The branch already accepted this
 * reasoning for edits, which are the less dangerous half of the same feature.
 */
describe("a mass disappearance is not diluted by the copies it left alone", () => {
  it("asks before destroying fifty originals whose copies vanished together", () => {
    const { deletes, result } = classifyVanished(50);

    expect(deletes).toEqual([]);
    expect(result.readHealth).toBe("healthy");
    expect(result.deleteBreakerTripped).toBe(true);
    expect(result.deleteConfirmation).toEqual({
      reason: "delete_breaker_tripped",
      sourceCalendarIds: [SOURCE_A],
    });
  });

  it("still deletes the originals of a handful of copies the user removed", () => {
    const { deletes, result } = classifyVanished(4);

    expect(deletes).toHaveLength(4);
    expect(result.deleteBreakerTripped).toBe(false);
    expect(result.deleteConfirmation).toBeNull();
  });

  it("deletes every original at the disclosed ceiling", () => {
    const { deletes, result } = classifyVanished(TWO_WAY_DELETE_ABSOLUTE_CEILING);

    expect(deletes).toHaveLength(TWO_WAY_DELETE_ABSOLUTE_CEILING);
    expect(result.deleteBreakerTripped).toBe(false);
  });

  it("asks about all of them one deletion past the disclosed ceiling", () => {
    const { deletes, result } = classifyVanished(TWO_WAY_DELETE_ABSOLUTE_CEILING + 1);

    expect(deletes).toEqual([]);
    expect(result.deleteBreakerTripped).toBe(true);
  });
});
