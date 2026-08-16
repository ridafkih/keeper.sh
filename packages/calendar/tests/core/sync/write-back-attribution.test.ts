import { describe, expect, it } from "vitest";
import { classifyInboundChanges } from "../../../src/core/sync/write-back";
import type { ReconciliationScope } from "../../../src/core/sync/operations";
import {
  createEditableEventContentHash,
  createSyncEventContentHash,
  normalizeText,
} from "../../../src/core/events/content-hash";
import type { EventMapping } from "../../../src/core/events/mappings";
import type {
  EventAvailability,
  MaterializedSyncableEvent,
  RemoteEvent,
} from "../../../src/core/types";

const SOURCE_CALENDAR_ID = "source-calendar-id";
const DESTINATION_CALENDAR_ID = "destination-calendar-id";
const MAPPING_ID = "mapping-id-1";
const START_TIME = new Date("2027-05-11T14:00:00.000Z");
const END_TIME = new Date("2027-05-11T15:00:00.000Z");
const NOW = new Date("2027-05-01T12:00:00.000Z");

const REAL_DESCRIPTION = "Bring the notes\nSecond line";
const GRAPH_RENDERED_DESCRIPTION = "Bring the notes\r\n\r\nSecond line ";
const ORIGINAL_SUMMARY = "Quarterly review";
const EDITED_SUMMARY = "Quarterly review with Dana";
const EDITED_DESCRIPTION = "Bring the notes and the deck";

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

interface ClassificationInput {
  existingMappings: TwoWayEventMapping[];
  localEvents: MaterializedSyncableEvent[];
  now: Date;
  remoteEvents: RemoteEvent[];
  remoteRawItemCount: number;
  scope: TwoWayReconciliationScope;
}

interface ObservedFields {
  description?: string;
  isAllDay: boolean;
  location?: string;
  summary: string;
}

const createPolicy = (overrides: Partial<WriteBackPolicy> = {}): WriteBackPolicy => ({
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

const createLocalEvent = (
  overrides: Partial<MaterializedSyncableEvent> = {},
): MaterializedSyncableEvent => ({
  availability: "busy",
  calendarId: SOURCE_CALENDAR_ID,
  calendarName: "Personal",
  calendarUrl: null,
  description: REAL_DESCRIPTION,
  endTime: END_TIME,
  eventStateId: "event-state-id-1",
  id: "event-state-id-1",
  isAllDay: false,
  location: "Room 4",
  sourceEventUid: "source-event-uid-1",
  startTime: START_TIME,
  summary: ORIGINAL_SUMMARY,
  ...overrides,
});

const toObservedRecord = (fields: ObservedFields) => ({
  description: fields.description,
  isAllDay: fields.isAllDay,
  location: fields.location,
  summary: fields.summary,
});

const createWitnessedMapping = (
  event: MaterializedSyncableEvent,
  observed: ObservedFields,
  overrides: Partial<TwoWayEventMapping> = {},
): TwoWayEventMapping => ({
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier: "destination-delete-id-1",
  destinationAvailability: "busy",
  destinationContentHash: createEditableEventContentHash(toObservedRecord(observed)),
  destinationDescription: normalizeText(observed.description),
  destinationEndTime: event.endTime,
  destinationEventUid: "destination-uid-1",
  destinationIsAllDay: observed.isAllDay,
  destinationLocation: normalizeText(observed.location),
  destinationStartTime: event.startTime,
  destinationSummary: normalizeText(observed.summary),
  endTime: event.endTime,
  eventStateId: event.eventStateId ?? event.id,
  id: MAPPING_ID,
  missingFirstObservedAt: null,
  missingObservationCount: 0,
  recurrenceId: null,
  recurrenceRule: null,
  sourceCalendarId: SOURCE_CALENDAR_ID,
  startTime: event.startTime,
  syncEventHash: createSyncEventContentHash(event),
  syncEventId: event.id,
  writeBackEpoch: 0,
  writeBackEpochWindowStart: null,
  ...overrides,
});

const createRemoteEvent = (
  mapping: TwoWayEventMapping,
  observed: ObservedFields,
): RemoteEvent => ({
  deleteId: mapping.deleteIdentifier,
  editableAvailability: "busy",
  editableContentHash: createEditableEventContentHash(toObservedRecord(observed)),
  editableFields: {
    isAllDay: observed.isAllDay,
    summary: observed.summary,
    ...(typeof observed.description === "string" && { description: observed.description }),
    ...(typeof observed.location === "string" && { location: observed.location }),
  },
  endTime: mapping.endTime,
  isKeeperEvent: true,
  startTime: mapping.startTime,
  supportedAvailabilities: ["busy", "free"],
  uid: mapping.destinationEventUid,
});

const buildInput = (
  policy: WriteBackPolicy,
  mapping: TwoWayEventMapping,
  event: MaterializedSyncableEvent,
  observed: ObservedFields,
): ClassificationInput => ({
  existingMappings: [mapping],
  localEvents: [event],
  now: NOW,
  remoteEvents: [createRemoteEvent(mapping, observed)],
  remoteRawItemCount: 1,
  scope: {
    authoritativeWindow: TEST_WINDOW,
    requestedWindow: TEST_WINDOW,
    writeBackPolicies: new Map([[SOURCE_CALENDAR_ID, policy]]),
  },
});

const classificationFor = (input: ClassificationInput): Record<string, unknown> => {
  const result = classifyInboundChanges(input);
  const classification = result.classifications.find(
    (candidate) => candidate.mappingId === MAPPING_ID,
  );
  if (!classification) {
    throw new Error("Expected a classification for the mapping under test");
  }
  return classification as unknown as Record<string, unknown>;
};

describe("two-way sync: a field is written back only if it moved against its own baseline", () => {
  it("leaves a re-encoded description out of the payload when only the summary was edited", () => {
    const event = createLocalEvent();
    const adopted: ObservedFields = {
      description: GRAPH_RENDERED_DESCRIPTION,
      isAllDay: false,
      location: "Room 4",
      summary: ORIGINAL_SUMMARY,
    };
    const mapping = createWitnessedMapping(event, adopted);
    const observed: ObservedFields = { ...adopted, summary: EDITED_SUMMARY };

    const classification = classificationFor(
      buildInput(createPolicy(), mapping, event, observed),
    );
    const updates = classification["updates"] as Record<string, unknown>;

    expect(classification["type"]).toBe("write-back");
    expect(updates["summary"]).toBe(EDITED_SUMMARY);
    expect(Object.hasOwn(updates, "description")).toBe(false);
    expect(Object.hasOwn(updates, "location")).toBe(false);
  });

  it("keeps the source description untouched when the destination re-encoded it alone", () => {
    const event = createLocalEvent();
    const adopted: ObservedFields = {
      description: REAL_DESCRIPTION,
      isAllDay: false,
      location: "Room 4",
      summary: ORIGINAL_SUMMARY,
    };
    const mapping = createWitnessedMapping(event, adopted);
    const observed: ObservedFields = {
      ...adopted,
      description: GRAPH_RENDERED_DESCRIPTION,
      summary: EDITED_SUMMARY,
    };

    const classification = classificationFor(
      buildInput(createPolicy(), mapping, event, observed),
    );
    const updates = classification["updates"] as Record<string, unknown>;

    expect(updates["summary"]).toBe(EDITED_SUMMARY);
    expect(Object.hasOwn(updates, "description")).toBe(false);
  });

  it("writes an edited description back on a mapping whose title is redacted", () => {
    const event = createLocalEvent({ summary: "Personal" });
    const adopted: ObservedFields = {
      description: REAL_DESCRIPTION,
      isAllDay: false,
      location: "Room 4",
      summary: "Personal",
    };
    const mapping = createWitnessedMapping(event, adopted);
    const observed: ObservedFields = {
      ...adopted,
      description: EDITED_DESCRIPTION,
      summary: "Dentist",
    };

    const input = buildInput(
      createPolicy({ excludeEventName: true }),
      mapping,
      event,
      observed,
    );
    const result = classifyInboundChanges(input);
    const classification = result.classifications.find(
      (candidate) => candidate.mappingId === MAPPING_ID,
    ) as unknown as Record<string, unknown>;
    const updates = classification["updates"] as Record<string, unknown>;

    expect(classification["type"]).toBe("write-back");
    expect(updates["description"]).toBe(EDITED_DESCRIPTION);
    expect(Object.hasOwn(updates, "summary")).toBe(false);
    expect(result.counters.blockedRedactedField).toBe(1);
  });

  /*
   * The rename cannot travel to the source, so the copy is put back rather than kept.
   * Recording "Dentist" as the new baseline would agree with the wrong copy and leave the
   * destination stably misnaming the user's time with nothing left to notice it.
   */
  it("repairs the copy rather than adopting it when every drifted field is redacted", () => {
    const event = createLocalEvent({ summary: "Personal" });
    const adopted: ObservedFields = {
      description: REAL_DESCRIPTION,
      isAllDay: false,
      location: "Room 4",
      summary: "Personal",
    };
    const mapping = createWitnessedMapping(event, adopted);
    const observed: ObservedFields = { ...adopted, summary: "Dentist" };

    const result = classifyInboundChanges(buildInput(
      createPolicy({ excludeEventName: true }),
      mapping,
      event,
      observed,
    ));
    const classification = result.classifications.find(
      (candidate) => candidate.mappingId === MAPPING_ID,
    ) as unknown as Record<string, unknown>;

    expect(classification["type"]).toBe("rejected");
    expect(classification["reason"]).toBe("redacted_field");
    expect(classification["mappingUpdate"]).toBeUndefined();
    expect(result.suppressedMappingIds).not.toContain(MAPPING_ID);
  });
});

describe("two-way sync: the witness adopts every component as one unit", () => {
  it("records each observed field alongside the hash on the first observation", () => {
    const event = createLocalEvent();
    const observed: ObservedFields = {
      description: GRAPH_RENDERED_DESCRIPTION,
      isAllDay: false,
      location: "Room 4 — Annex",
      summary: ORIGINAL_SUMMARY,
    };
    const mapping = createWitnessedMapping(event, observed, {
      destinationContentHash: null,
      destinationDescription: null,
      destinationEndTime: null,
      destinationIsAllDay: null,
      destinationLocation: null,
      destinationStartTime: null,
      destinationSummary: null,
    });

    const classification = classificationFor(
      buildInput(createPolicy(), mapping, event, observed),
    );
    const update = classification["mappingUpdate"] as Record<string, unknown>;

    expect(classification["type"]).toBe("adopt-baseline");
    expect(update["destinationSummary"]).toBe(normalizeText(observed.summary));
    expect(update["destinationDescription"]).toBe(normalizeText(observed.description));
    expect(update["destinationLocation"]).toBe(normalizeText(observed.location));
    expect(update["destinationIsAllDay"]).toBe(false);
  });

  it("stores the field values already normalized the way the hash normalizes them", () => {
    const event = createLocalEvent();
    const observed: ObservedFields = {
      description: GRAPH_RENDERED_DESCRIPTION,
      isAllDay: false,
      location: "  Room 4  ",
      summary: "  Quarterly review\r\n",
    };
    const mapping = createWitnessedMapping(event, observed, {
      destinationContentHash: null,
      destinationDescription: null,
      destinationIsAllDay: null,
      destinationLocation: null,
      destinationSummary: null,
    });

    const update = classificationFor(
      buildInput(createPolicy(), mapping, event, observed),
    )["mappingUpdate"] as Record<string, unknown>;

    expect(update["destinationSummary"]).toBe("Quarterly review");
    expect(update["destinationLocation"]).toBe("Room 4");
    expect(update["destinationDescription"]).toBe("Bring the notes\n\nSecond line");
  });

  it("keeps the stored hash equal to the hash of the stored fields", () => {
    const event = createLocalEvent();
    const observed: ObservedFields = {
      description: GRAPH_RENDERED_DESCRIPTION,
      isAllDay: false,
      location: "  Room 4  ",
      summary: "  Quarterly review\r\n",
    };
    const mapping = createWitnessedMapping(event, observed, {
      destinationContentHash: null,
      destinationDescription: null,
      destinationIsAllDay: null,
      destinationLocation: null,
      destinationSummary: null,
    });

    const update = classificationFor(
      buildInput(createPolicy(), mapping, event, observed),
    )["mappingUpdate"] as Record<string, unknown>;

    expect(update["destinationContentHash"]).toBe(createEditableEventContentHash({
      description: update["destinationDescription"] as string,
      isAllDay: update["destinationIsAllDay"] as boolean,
      location: update["destinationLocation"] as string,
      summary: update["destinationSummary"] as string,
    }));
  });

  it("re-adopts every component after an applied write-back, not just the hash", () => {
    const event = createLocalEvent();
    const adopted: ObservedFields = {
      description: REAL_DESCRIPTION,
      isAllDay: false,
      location: "Room 4",
      summary: ORIGINAL_SUMMARY,
    };
    const mapping = createWitnessedMapping(event, adopted);
    const observed: ObservedFields = { ...adopted, summary: EDITED_SUMMARY };

    const classification = classificationFor(
      buildInput(createPolicy(), mapping, event, observed),
    );
    const observedState = classification["observed"] as Record<string, unknown>;

    expect(observedState["summary"]).toBe(normalizeText(EDITED_SUMMARY));
    expect(observedState["description"]).toBe(normalizeText(REAL_DESCRIPTION));
    expect(observedState["location"]).toBe(normalizeText("Room 4"));
    expect(observedState["isAllDay"]).toBe(false);
  });
});
