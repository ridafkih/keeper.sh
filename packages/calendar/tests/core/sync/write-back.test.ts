import { describe, expect, it } from "vitest";
import {
  assertWriteBackPayload,
  classifyInboundChanges,
  getDestinationDrift,
  resolveWriteBackEligibleFields,
} from "../../../src/core/sync/write-back";
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

const SOURCE_CALENDAR_ID = "source-calendar-id";
const DESTINATION_CALENDAR_ID = "destination-calendar-id";
const START_TIME = new Date("2027-05-11T14:00:00.000Z");
const END_TIME = new Date("2027-05-11T15:00:00.000Z");
const MOVED_START_TIME = new Date("2027-05-11T17:00:00.000Z");
const MOVED_END_TIME = new Date("2027-05-11T18:00:00.000Z");
const NOW = new Date("2027-05-01T12:00:00.000Z");
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const GRACE_MS = 10 * MINUTE_MS;
const DELETE_ABSOLUTE_FLOOR = 5;

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
  writeBackLastAppliedAt?: Date | null;
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

const REDACTED_POLICY = createPolicy({
  excludeEventDescription: true,
  excludeEventLocation: true,
  excludeEventName: true,
});

const createLocalEvent = (
  overrides: Partial<MaterializedSyncableEvent> = {},
): MaterializedSyncableEvent => ({
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
  ...overrides,
});

const createMapping = (
  event: MaterializedSyncableEvent,
  overrides: Partial<TwoWayEventMapping> = {},
): TwoWayEventMapping => ({
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier: "destination-delete-id-1",
  destinationAvailability: "busy",
  destinationContentHash: createEditableEventContentHash(event),
  destinationDescription: normalizeText(event.description),
  destinationEndTime: event.endTime,
  destinationEventUid: "destination-uid-1",
  destinationIsAllDay: resolveIsAllDayEvent({
    endTime: event.endTime,
    ...(typeof event.isAllDay === "boolean" && { isAllDay: event.isAllDay }),
    startTime: event.startTime,
  }),
  destinationLocation: normalizeText(event.location),
  destinationStartTime: event.startTime,
  destinationSummary: normalizeText(event.summary),
  endTime: event.endTime,
  eventStateId: event.eventStateId ?? event.id,
  id: "mapping-id-1",
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
  event: MaterializedSyncableEvent,
  overrides: Partial<RemoteEvent> = {},
): RemoteEvent & {
  editableFields?: {
    description?: string;
    isAllDay: boolean;
    location?: string;
    summary: string;
  };
} => ({
  deleteId: mapping.deleteIdentifier,
  editableAvailability: "busy",
  editableContentHash: createEditableEventContentHash(event),
  editableFields: {
    isAllDay: event.isAllDay ?? false,
    summary: event.summary,
    ...(event.description && { description: event.description }),
    ...(event.location && { location: event.location }),
  },
  endTime: mapping.endTime,
  isKeeperEvent: true,
  startTime: mapping.startTime,
  supportedAvailabilities: ["busy", "free"],
  uid: mapping.destinationEventUid,
  ...overrides,
});

const createBareLocalEvent = (summary: string): MaterializedSyncableEvent => {
  const { description, location, ...rest } = createLocalEvent();
  expect(description).toBeTypeOf("string");
  expect(location).toBeTypeOf("string");
  return { ...rest, summary };
};

const countDeletes = (result: { classifications: { type: string }[] }): number =>
  result.classifications.filter((classification) => classification.type === "delete").length;

const createInput = (overrides: Partial<ClassificationInput> = {}): ClassificationInput => {
  const event = createLocalEvent();
  const mapping = createMapping(event);
  return {
    existingMappings: [mapping],
    localEvents: [event],
    now: NOW,
    remoteEvents: [createRemoteEvent(mapping, event)],
    remoteRawItemCount: 1,
    scope: {
      authoritativeWindow: TEST_WINDOW,
      requestedWindow: TEST_WINDOW,
      writeBackPolicies: new Map([[SOURCE_CALENDAR_ID, createPolicy()]]),
    },
    ...overrides,
  };
};

const classificationFor = (
  input: ClassificationInput,
  mappingId = "mapping-id-1",
): Record<string, unknown> => {
  const result = classifyInboundChanges(input);
  const classification = result.classifications.find(
    (candidate: { mappingId: string }) => candidate.mappingId === mappingId,
  );
  if (!classification) {
    throw new Error(`Expected a classification for ${mappingId}`);
  }
  return classification;
};

describe("getDestinationDrift", () => {
  it("reports no drift while the recorded observation matches the destination", () => {
    const event = createLocalEvent();
    const mapping = createMapping(event);

    expect(getDestinationDrift(mapping, createRemoteEvent(mapping, event))).toEqual({
      availability: false,
      content: false,
      time: false,
    });
  });

  it("reports drift per axis against the recorded observation, never against the source", () => {
    const event = createLocalEvent();
    const mapping = createMapping(event);
    const edited = createLocalEvent({ summary: "Renamed on the destination" });

    expect(getDestinationDrift(mapping, createRemoteEvent(mapping, event, {
      editableContentHash: createEditableEventContentHash(edited),
    }))).toMatchObject({ content: true, time: false });

    expect(getDestinationDrift(mapping, createRemoteEvent(mapping, event, {
      endTime: MOVED_END_TIME,
      startTime: MOVED_START_TIME,
    }))).toMatchObject({ content: false, time: true });

    expect(getDestinationDrift(mapping, createRemoteEvent(mapping, event, {
      editableAvailability: "free",
    }))).toMatchObject({ availability: true, content: false, time: false });
  });

  it("reports no drift on any axis while the observation is unverified", () => {
    const event = createLocalEvent();
    const mapping = createMapping(event, {
      destinationAvailability: null,
      destinationContentHash: null,
      destinationEndTime: null,
      destinationStartTime: null,
    });

    expect(getDestinationDrift(mapping, createRemoteEvent(mapping, event, {
      editableAvailability: "free",
      editableContentHash: "a-completely-different-hash",
      endTime: MOVED_END_TIME,
      startTime: MOVED_START_TIME,
    }))).toEqual({ availability: false, content: false, time: false });
  });

  it("absorbs sub-second provider jitter on the time axis", () => {
    const event = createLocalEvent();
    const mapping = createMapping(event);

    expect(getDestinationDrift(mapping, createRemoteEvent(mapping, event, {
      endTime: new Date(END_TIME.getTime() + 400),
      startTime: new Date(START_TIME.getTime() + 400),
    }))).toMatchObject({ time: false });
  });
});

describe("write-back eligibility", () => {
  it("treats time and all-day as always eligible and redacted fields as never eligible", () => {
    const eligible = resolveWriteBackEligibleFields(REDACTED_POLICY);

    expect([...eligible].toSorted()).toEqual([
      "endTime",
      "isAllDay",
      "startTime",
      "startTimeZone",
    ]);
  });

  it("adds the content fields when their projection is the identity", () => {
    const eligible = resolveWriteBackEligibleFields(createPolicy());

    expect([...eligible].toSorted()).toEqual([
      "description",
      "endTime",
      "isAllDay",
      "location",
      "startTime",
      "startTimeZone",
      "summary",
    ]);
  });

  it("throws rather than defaulting when the policy is missing", () => {
    const emptyPolicies = new Map<string, WriteBackPolicy>();

    expect(() => resolveWriteBackEligibleFields(emptyPolicies.get(SOURCE_CALENDAR_ID)))
      .toThrow();
  });

  it("throws when a payload carries a field the projection redacts", () => {
    const eligible = resolveWriteBackEligibleFields(REDACTED_POLICY);

    expect(() => assertWriteBackPayload({ summary: "Dentist" }, eligible)).toThrow();
    expect(() => assertWriteBackPayload({
      endTime: MOVED_END_TIME,
      isAllDay: false,
      startTime: MOVED_START_TIME,
    }, eligible)).not.toThrow();
  });

  it("throws on a schedule payload that omits the all-day flag", () => {
    const eligible = resolveWriteBackEligibleFields(createPolicy());

    expect(() => assertWriteBackPayload({
      endTime: MOVED_END_TIME,
      startTime: MOVED_START_TIME,
    }, eligible)).toThrow(/partial schedule/);
    expect(() => assertWriteBackPayload({ isAllDay: true }, eligible))
      .toThrow(/partial schedule/);
  });
});

describe("classifyInboundChanges: recording what the destination reported", () => {
  it("adopts the observation without acting when the mapping is unverified", () => {
    const event = createLocalEvent();
    const mapping = createMapping(event, {
      destinationAvailability: null,
      destinationContentHash: null,
      destinationEndTime: null,
      destinationStartTime: null,
    });
    const rendered = createLocalEvent({ description: "Bring the notes  \n\n" });
    const remoteEvent = createRemoteEvent(mapping, rendered, {
      editableAvailability: "free",
    });

    const result = classifyInboundChanges(createInput({
      existingMappings: [mapping],
      remoteEvents: [remoteEvent],
    }));

    expect(result.classifications).toMatchObject([{
      mappingId: mapping.id,
      observed: {
        availability: "free",
        contentHash: remoteEvent.editableContentHash,
        endTime: mapping.endTime,
        startTime: mapping.startTime,
      },
      type: "adopt-baseline",
    }]);
  });

  /*
   * The divergence is swallowed by design: one observation cannot separate a user's edit
   * from the destination re-encoding the push. The count is what keeps it from being
   * silent, so it is pinned here.
   */
  it("counts an unverified copy that moved while still adopting what it reports", () => {
    const event = createLocalEvent();
    const mapping = createMapping(event, {
      destinationAvailability: null,
      destinationContentHash: null,
      destinationEndTime: null,
      destinationStartTime: null,
    });
    const remoteEvent = createRemoteEvent(mapping, event, {
      endTime: MOVED_END_TIME,
      startTime: MOVED_START_TIME,
    });

    const result = classifyInboundChanges(createInput({
      existingMappings: [mapping],
      remoteEvents: [remoteEvent],
    }));

    expect(result.classifications).toMatchObject([{ type: "adopt-baseline" }]);
    expect(result.counters.adoptWindowDivergence).toBe(1);
  });

  it("never records a content hash without the matching observed times", () => {
    const event = createLocalEvent();
    const mapping = createMapping(event, {
      destinationAvailability: null,
      destinationContentHash: null,
      destinationEndTime: null,
      destinationStartTime: null,
    });

    const classification = classificationFor(createInput({ existingMappings: [mapping] }));
    const observed = classification.observed as Record<string, unknown>;

    expect(observed.contentHash).toEqual(expect.any(String));
    expect(observed.startTime).toBeInstanceOf(Date);
    expect(observed.endTime).toBeInstanceOf(Date);
  });

  it("does not read our own push back as a user edit", () => {
    expect(classificationFor(createInput())).toMatchObject({ type: "none" });
  });

  it("does not read a source-side edit as a destination edit", () => {
    const pushedEvent = createLocalEvent();
    const mapping = createMapping(pushedEvent);
    const editedOnSource = createLocalEvent({ summary: "Renamed on the source" });

    expect(classificationFor(createInput({
      localEvents: [editedOnSource],
      remoteEvents: [createRemoteEvent(mapping, pushedEvent)],
    }))).toMatchObject({ type: "none" });
  });
});

describe("classifyInboundChanges: propagating a destination edit to the source", () => {
  it("writes a destination rename, description and location back to the source event", () => {
    const event = createLocalEvent();
    const mapping = createMapping(event);
    const editedOnDestination = createLocalEvent({
      description: "Bring the revised notes",
      location: "Room 9",
      summary: "Quarterly review with Dana",
    });

    expect(classificationFor(createInput({
      remoteEvents: [createRemoteEvent(mapping, event, {
        editableContentHash: createEditableEventContentHash(editedOnDestination),
        editableFields: {
          description: "Bring the revised notes",
          isAllDay: false,
          location: "Room 9",
          summary: "Quarterly review with Dana",
        },
      })],
    }))).toMatchObject({
      sourceEventUid: "source-event-uid-1",
      type: "write-back",
      updates: {
        description: "Bring the revised notes",
        location: "Room 9",
        summary: "Quarterly review with Dana",
      },
    });
  });

  it("writes a destination time move back to the source event", () => {
    const event = createLocalEvent();
    const mapping = createMapping(event);

    const classification = classificationFor(createInput({
      remoteEvents: [createRemoteEvent(mapping, event, {
        endTime: MOVED_END_TIME,
        startTime: MOVED_START_TIME,
      })],
    }));

    expect(classification).toMatchObject({
      type: "write-back",
      updates: { endTime: MOVED_END_TIME, startTime: MOVED_START_TIME },
    });
    expect(classification.updates as Record<string, unknown>).not.toHaveProperty("summary");
  });

  it("adopts the observation on the same pass it writes back", () => {
    const event = createLocalEvent();
    const mapping = createMapping(event);

    expect(classificationFor(createInput({
      remoteEvents: [createRemoteEvent(mapping, event, {
        endTime: MOVED_END_TIME,
        startTime: MOVED_START_TIME,
      })],
    }))).toMatchObject({
      observed: { endTime: MOVED_END_TIME, startTime: MOVED_START_TIME },
      type: "write-back",
    });
  });

  it("carries the hash the reconcile path will compute for the post-edit source event", () => {
    const event = createLocalEvent({ summary: "Personal" });
    const mapping = createMapping(event);

    const classification = classificationFor(createInput({
      existingMappings: [mapping],
      localEvents: [event],
      remoteEvents: [createRemoteEvent(mapping, event, {
        endTime: MOVED_END_TIME,
        startTime: MOVED_START_TIME,
      })],
      scope: {
        authoritativeWindow: TEST_WINDOW,
        requestedWindow: TEST_WINDOW,
        writeBackPolicies: new Map([[SOURCE_CALENDAR_ID, REDACTED_POLICY]]),
      },
    }));

    expect(classification.projectedSyncEventHash).toBe(createSyncEventContentHash({
      ...event,
      endTime: MOVED_END_TIME,
      startTime: MOVED_START_TIME,
    }));
  });

  it("takes no inbound action at all when the mapping is one-way", () => {
    const event = createLocalEvent();
    const mapping = createMapping(event);

    const result = classifyInboundChanges(createInput({
      remoteEvents: [createRemoteEvent(mapping, event, {
        endTime: MOVED_END_TIME,
        startTime: MOVED_START_TIME,
      })],
      scope: {
        authoritativeWindow: TEST_WINDOW,
        requestedWindow: TEST_WINDOW,
        writeBackPolicies: new Map([[
          SOURCE_CALENDAR_ID,
          createPolicy({ writeBackMode: "off" }),
        ]]),
      },
    }));

    expect(result.classifications).toEqual([]);
  });
});

describe("classifyInboundChanges: redacted fields are never written back", () => {
  it("rejects a rename on a redacted mapping and carries no summary in the payload", () => {
    const event = createBareLocalEvent("Personal");
    const mapping = createMapping(event);
    const renamedOnDestination = createBareLocalEvent("Dentist");

    const classification = classificationFor(createInput({
      localEvents: [event],
      remoteEvents: [createRemoteEvent(mapping, event, {
        editableContentHash: createEditableEventContentHash(renamedOnDestination),
        editableFields: { isAllDay: false, summary: "Dentist" },
      })],
      scope: {
        authoritativeWindow: TEST_WINDOW,
        requestedWindow: TEST_WINDOW,
        writeBackPolicies: new Map([[SOURCE_CALENDAR_ID, REDACTED_POLICY]]),
      },
    }));

    expect(classification).toMatchObject({ reason: "redacted_field", type: "rejected" });
    expect(classification).not.toHaveProperty("updates");
  });

  it("adopts the baseline on a rejection so the divergence does not refire every pass", () => {
    const event = createLocalEvent({ summary: "Personal" });
    const mapping = createMapping(event);
    const renamed = createLocalEvent({ summary: "Dentist" });
    const remoteEvent = createRemoteEvent(mapping, event, {
      editableContentHash: createEditableEventContentHash(renamed),
      editableFields: { isAllDay: false, summary: "Dentist" },
    });

    expect(classificationFor(createInput({
      remoteEvents: [remoteEvent],
      scope: {
        authoritativeWindow: TEST_WINDOW,
        requestedWindow: TEST_WINDOW,
        writeBackPolicies: new Map([[SOURCE_CALENDAR_ID, REDACTED_POLICY]]),
      },
    }))).toMatchObject({
      observed: { contentHash: remoteEvent.editableContentHash },
      type: "rejected",
    });
  });

  it("still writes a time move back on a fully redacted mapping", () => {
    const event = createLocalEvent({ summary: "Personal" });
    const mapping = createMapping(event);

    expect(classificationFor(createInput({
      remoteEvents: [createRemoteEvent(mapping, event, {
        endTime: MOVED_END_TIME,
        startTime: MOVED_START_TIME,
      })],
      scope: {
        authoritativeWindow: TEST_WINDOW,
        requestedWindow: TEST_WINDOW,
        writeBackPolicies: new Map([[SOURCE_CALENDAR_ID, REDACTED_POLICY]]),
      },
    }))).toMatchObject({
      type: "write-back",
      updates: { endTime: MOVED_END_TIME, startTime: MOVED_START_TIME },
    });
  });
});

describe("classifyInboundChanges: availability clamping", () => {
  it("does not read a clamped availability as a destination edit", () => {
    const event = createLocalEvent({ availability: "oof" });
    const mapping = createMapping(event, { destinationAvailability: "busy" });

    expect(classificationFor(createInput({
      localEvents: [event],
      remoteEvents: [createRemoteEvent(mapping, event, {
        editableAvailability: "busy",
        supportedAvailabilities: ["busy", "free"],
      })],
    }))).toMatchObject({ type: "none" });
  });

  it("refuses to downgrade a real out-of-office when the destination cannot express it", () => {
    const event = createLocalEvent({ availability: "oof" });
    const mapping = createMapping(event, { destinationAvailability: "busy" });

    expect(classificationFor(createInput({
      localEvents: [event],
      remoteEvents: [createRemoteEvent(mapping, event, {
        editableAvailability: "free",
        supportedAvailabilities: ["busy", "free"],
      })],
    }))).toMatchObject({ reason: "availability_clamped", type: "rejected" });
  });

  /*
   * Availability is never carried in a payload, so an availability edit is always
   * swallowed. It has to be counted even on the pass that writes some other axis back, or
   * the one edit that is silently discarded is the one nothing reports.
   */
  it("counts an availability edit that rides along with a writable one", () => {
    const event = createLocalEvent();
    const mapping = createMapping(event);

    const result = classifyInboundChanges(createInput({
      localEvents: [event],
      remoteEvents: [createRemoteEvent(mapping, event, {
        editableAvailability: "free",
        endTime: MOVED_END_TIME,
        startTime: MOVED_START_TIME,
      })],
    }));

    expect(result.classifications[0]).toMatchObject({ type: "write-back" });
    expect(result.counters.blockedAvailability).toBe(1);
  });

  it("counts an availability edit that is the only thing that moved", () => {
    const event = createLocalEvent();
    const mapping = createMapping(event);

    const result = classifyInboundChanges(createInput({
      localEvents: [event],
      remoteEvents: [createRemoteEvent(mapping, event, { editableAvailability: "free" })],
    }));

    expect(result.classifications[0])
      .toMatchObject({ reason: "availability_not_writable", type: "rejected" });
    expect(result.counters.blockedAvailability).toBe(1);
  });
});

describe("classifyInboundChanges: both sides changed since our last write", () => {
  it("resolves a same-axis divergence in favour of the source and writes nothing back", () => {
    const pushedEvent = createLocalEvent();
    const mapping = createMapping(pushedEvent);
    const editedOnSource = createLocalEvent({ summary: "Renamed on the source" });
    const editedOnDestination = createLocalEvent({ summary: "Renamed on the destination" });

    const result = classifyInboundChanges(createInput({
      localEvents: [editedOnSource],
      remoteEvents: [createRemoteEvent(mapping, pushedEvent, {
        editableContentHash: createEditableEventContentHash(editedOnDestination),
        editableFields: { isAllDay: false, summary: "Renamed on the destination" },
      })],
    }));

    expect(result.classifications).toMatchObject([{
      mappingId: mapping.id,
      resolution: "source-wins",
      type: "conflict",
    }]);
    expect(result.counters.conflictSourceWins).toBe(1);
  });

  it("ignores any provider modification clock the destination happens to expose", () => {
    const pushedEvent = createLocalEvent();
    const mapping = createMapping(pushedEvent);
    const editedOnSource = createLocalEvent({ summary: "Renamed on the source" });
    const editedOnDestination = createLocalEvent({ summary: "Renamed on the destination" });
    const remoteEvent = createRemoteEvent(mapping, pushedEvent, {
      editableContentHash: createEditableEventContentHash(editedOnDestination),
      editableFields: { isAllDay: false, summary: "Renamed on the destination" },
    });

    const withoutClock = classifyInboundChanges(createInput({
      localEvents: [editedOnSource],
      remoteEvents: [remoteEvent],
    }));
    const withLaterClock = classifyInboundChanges(createInput({
      localEvents: [editedOnSource],
      remoteEvents: [{
        ...remoteEvent,
        lastModifiedDateTime: "2099-01-01T00:00:00.000Z",
        updated: "2099-01-01T00:00:00.000Z",
      } as RemoteEvent],
    }));

    expect(withLaterClock).toEqual(withoutClock);
    expect(withLaterClock.classifications).toMatchObject([{ resolution: "source-wins" }]);
  });

  it("merges disjoint axes: the source moved the time and the destination changed content", () => {
    const pushedEvent = createLocalEvent();
    const mapping = createMapping(pushedEvent);
    const movedOnSource = createLocalEvent({
      endTime: MOVED_END_TIME,
      startTime: MOVED_START_TIME,
    });
    const editedOnDestination = createLocalEvent({ summary: "Renamed on the destination" });

    expect(classificationFor(createInput({
      localEvents: [movedOnSource],
      remoteEvents: [createRemoteEvent(mapping, pushedEvent, {
        editableContentHash: createEditableEventContentHash(editedOnDestination),
        editableFields: { isAllDay: false, summary: "Renamed on the destination" },
      })],
    }))).toMatchObject({
      type: "write-back",
      updates: { summary: "Renamed on the destination" },
    });
  });
});

describe("classifyInboundChanges: recurring mappings are refused", () => {
  const editedRemote = (mapping: TwoWayEventMapping, event: MaterializedSyncableEvent) =>
    createRemoteEvent(mapping, event, {
      endTime: MOVED_END_TIME,
      startTime: MOVED_START_TIME,
    });

  it("refuses a series master", () => {
    const event = createLocalEvent();
    const mapping = createMapping(event, { recurrenceRule: "FREQ=WEEKLY" });

    expect(classificationFor(createInput({
      existingMappings: [mapping],
      remoteEvents: [editedRemote(mapping, event)],
    }))).toMatchObject({ reason: "recurring_event", type: "rejected" });
  });

  it("refuses a materialized occurrence", () => {
    const event = createLocalEvent({
      eventStateId: "recurring-master-state",
      id: "materialized-occurrence-1",
    });
    const mapping = createMapping(event, {
      eventStateId: "recurring-master-state",
      syncEventId: "materialized-occurrence-1",
    });

    expect(classificationFor(createInput({
      existingMappings: [mapping],
      localEvents: [event],
      remoteEvents: [editedRemote(mapping, event)],
    }))).toMatchObject({ reason: "recurring_event", type: "rejected" });
  });

  it("refuses a detached override, which the materialized event cannot reveal", () => {
    const event = createLocalEvent();
    const mapping = createMapping(event, {
      recurrenceId: new Date("2027-05-11T14:00:00.000Z"),
      recurrenceRule: null,
    });

    expect(mapping.syncEventId).toBe(mapping.eventStateId);
    expect(classificationFor(createInput({
      existingMappings: [mapping],
      remoteEvents: [editedRemote(mapping, event)],
    }))).toMatchObject({ reason: "recurring_event", type: "rejected" });
  });
});

describe("classifyInboundChanges: a missing mirror is not a deletion signal", () => {
  const deletePolicyScope: TwoWayReconciliationScope = {
    authoritativeWindow: TEST_WINDOW,
    requestedWindow: TEST_WINDOW,
    writeBackPolicies: new Map([[
      SOURCE_CALENDAR_ID,
      createPolicy({ writeBackMode: "edits_and_deletes" }),
    ]]),
  };

  const missingInput = (
    mappingOverrides: Partial<TwoWayEventMapping>,
    now: Date,
  ): ClassificationInput => {
    const event = createLocalEvent();
    return createInput({
      existingMappings: [createMapping(event, mappingOverrides)],
      localEvents: [event],
      now,
      remoteEvents: [],
      remoteRawItemCount: 4,
      scope: deletePolicyScope,
    });
  };

  it("only records the first observation", () => {
    expect(classificationFor(missingInput({}, NOW))).toMatchObject({
      missingObservationCount: 1,
      type: "delete-candidate",
    });
  });

  it("suppresses the ordinary re-create while a deletion is pending", () => {
    const result = classifyInboundChanges(missingInput({}, NOW));

    expect(result.suppressedMappingIds).toContain("mapping-id-1");
  });

  it("still refuses on a second observation inside the grace window", () => {
    expect(classificationFor(missingInput({
      missingFirstObservedAt: new Date(NOW.getTime() - 3 * MINUTE_MS),
      missingObservationCount: 1,
    }, NOW))).toMatchObject({ missingObservationCount: 2, type: "delete-candidate" });
  });

  it("deletes once two observations span the grace window", () => {
    const classification = classificationFor(missingInput({
      missingFirstObservedAt: new Date(NOW.getTime() - GRACE_MS - MINUTE_MS),
      missingObservationCount: 1,
    }, NOW));

    expect(classification).toMatchObject({
      expectedSource: { endTime: END_TIME, isAllDay: false, startTime: START_TIME },
      sourceEventUid: "source-event-uid-1",
      type: "delete",
    });
  });

  /*
   * The snapshot the tombstone keeps is read from the source row by the applier. The
   * classifier only ever sees the redacted projection, so a snapshot taken here would
   * record a template title and no description under the default privacy settings.
   */
  it("never carries the redacted projection as a deletion record", () => {
    expect(classificationFor(missingInput({
      missingFirstObservedAt: new Date(NOW.getTime() - GRACE_MS - MINUTE_MS),
      missingObservationCount: 1,
    }, NOW))).not.toHaveProperty("snapshot");
  });

  it("resets the counters the moment the mirror reappears", () => {
    const event = createLocalEvent();
    const mapping = createMapping(event, {
      missingFirstObservedAt: new Date(NOW.getTime() - GRACE_MS - MINUTE_MS),
      missingObservationCount: 4,
    });

    expect(classificationFor(createInput({
      existingMappings: [mapping],
      localEvents: [event],
      remoteEvents: [createRemoteEvent(mapping, event)],
      scope: deletePolicyScope,
    }))).toMatchObject({ missingObservationCount: 0, type: "none" });
  });

  it("never deletes when the mapping is only in edits mode", () => {
    const result = classifyInboundChanges(createInput({
      localEvents: [createLocalEvent()],
      now: new Date(NOW.getTime() + GRACE_MS + MINUTE_MS),
      remoteEvents: [],
      remoteRawItemCount: 4,
      scope: {
        authoritativeWindow: TEST_WINDOW,
        requestedWindow: TEST_WINDOW,
        writeBackPolicies: new Map([[SOURCE_CALENDAR_ID, createPolicy()]]),
      },
    }));

    expect(result.classifications.filter(
      (classification: { type: string }) => classification.type === "delete",
    )).toEqual([]);
  });

  it("never deletes a mapping whose source event is absent from the local read", () => {
    const result = classifyInboundChanges(createInput({
      existingMappings: [createMapping(createLocalEvent(), {
        missingFirstObservedAt: new Date(NOW.getTime() - GRACE_MS - MINUTE_MS),
        missingObservationCount: 3,
      })],
      localEvents: [],
      remoteEvents: [],
      remoteRawItemCount: 4,
      scope: deletePolicyScope,
    }));

    expect(result.classifications.filter(
      (classification: { type: string }) => classification.type === "delete",
    )).toEqual([]);
  });

  it("never deletes a withheld series or a mapping outside the source authority window", () => {
    const event = createLocalEvent();
    const pastGrace = {
      missingFirstObservedAt: new Date(NOW.getTime() - GRACE_MS - MINUTE_MS),
      missingObservationCount: 3,
    };

    const withheld = classifyInboundChanges(createInput({
      existingMappings: [createMapping(event, pastGrace)],
      localEvents: [event],
      remoteEvents: [],
      remoteRawItemCount: 4,
      scope: {
        ...deletePolicyScope,
        withheldSourceEventStateIds: new Set(["event-state-id-1"]),
      },
    }));

    const unprovenCoverage = classifyInboundChanges(createInput({
      existingMappings: [createMapping(event, pastGrace)],
      localEvents: [event],
      remoteEvents: [],
      remoteRawItemCount: 4,
      scope: { ...deletePolicyScope, authoritativeWindow: null },
    }));

    for (const result of [withheld, unprovenCoverage]) {
      expect(result.classifications.filter(
        (classification: { type: string }) => classification.type === "delete",
      )).toEqual([]);
    }
  });

  it("never deletes a recurring mapping", () => {
    const event = createLocalEvent();
    const result = classifyInboundChanges(createInput({
      existingMappings: [createMapping(event, {
        missingFirstObservedAt: new Date(NOW.getTime() - GRACE_MS - MINUTE_MS),
        missingObservationCount: 3,
        recurrenceRule: "FREQ=WEEKLY",
      })],
      localEvents: [event],
      remoteEvents: [],
      remoteRawItemCount: 4,
      scope: deletePolicyScope,
    }));

    expect(result.classifications).toMatchObject([{
      reason: "recurring_event",
      type: "rejected",
    }]);
  });
});

describe("classifyInboundChanges: read health, not mirror count", () => {
  const buildMirrorSet = (count: number, pastGrace: boolean) => {
    const localEvents: MaterializedSyncableEvent[] = [];
    const existingMappings: TwoWayEventMapping[] = [];
    for (let index = 0; index < count; index++) {
      const event = createLocalEvent({
        eventStateId: `event-state-id-${index}`,
        id: `event-state-id-${index}`,
        sourceEventUid: `source-event-uid-${index}`,
      });
      localEvents.push(event);
      existingMappings.push(createMapping(event, {
        deleteIdentifier: `destination-delete-id-${index}`,
        destinationEventUid: `destination-uid-${index}`,
        id: `mapping-id-${index}`,
        ...(pastGrace && {
          missingFirstObservedAt: new Date(NOW.getTime() - GRACE_MS - MINUTE_MS),
          missingObservationCount: 3,
        }),
      }));
    }
    return { existingMappings, localEvents };
  };

  const deleteScope: TwoWayReconciliationScope = {
    authoritativeWindow: TEST_WINDOW,
    requestedWindow: TEST_WINDOW,
    writeBackPolicies: new Map([[
      SOURCE_CALENDAR_ID,
      createPolicy({ writeBackMode: "edits_and_deletes" }),
    ]]),
  };

  it("treats a fully empty read as ambiguous and applies no deletions", () => {
    const result = classifyInboundChanges(createInput({
      ...buildMirrorSet(40, true),
      remoteEvents: [],
      remoteRawItemCount: 0,
      scope: deleteScope,
    }));

    expect(result.readHealth).toBe("ambiguous_empty");
    expect(countDeletes(result)).toBe(0);
    expect(result.counters.ambiguousEmptyRead).toBe(1);
    expect(result.suppressedMappingIds).toHaveLength(40);
  });

  it("treats a live calendar with no mirrors as a real observation held for confirmation", () => {
    const result = classifyInboundChanges(createInput({
      ...buildMirrorSet(40, true),
      remoteEvents: [],
      remoteRawItemCount: 12,
      scope: deleteScope,
    }));

    expect(result.readHealth).toBe("live_empty");
    expect(result.deleteBreakerTripped).toBe(true);
    expect(countDeletes(result)).toBe(0);
    expect(result.counters.deleteBreakerTripped).toBe(1);
  });

  it("applies deletions on a live calendar when the candidate count is under the floor", () => {
    const result = classifyInboundChanges(createInput({
      ...buildMirrorSet(3, true),
      remoteEvents: [],
      remoteRawItemCount: 5,
      scope: deleteScope,
    }));

    expect(result.deleteBreakerTripped).toBe(false);
    expect(countDeletes(result)).toBe(3);
  });

  it("trips the breaker when a fifth of a large destination disappears at once", () => {
    const { existingMappings, localEvents } = buildMirrorSet(30, true);
    const survivingMappings = existingMappings.slice(20);
    const result = classifyInboundChanges(createInput({
      existingMappings,
      localEvents,
      remoteEvents: survivingMappings.map((mapping, index) =>
        createRemoteEvent(mapping, localEvents[index + 20] as MaterializedSyncableEvent)),
      remoteRawItemCount: survivingMappings.length,
      scope: deleteScope,
    }));

    expect(result.deleteBreakerTripped).toBe(true);
    expect(countDeletes(result)).toBe(0);
  });

  it("proceeds when only a handful of a large destination is missing", () => {
    const { existingMappings, localEvents } = buildMirrorSet(300, true);
    const survivingMappings = existingMappings.slice(2);
    const result = classifyInboundChanges(createInput({
      existingMappings,
      localEvents,
      remoteEvents: survivingMappings.map((mapping, index) =>
        createRemoteEvent(mapping, localEvents[index + 2] as MaterializedSyncableEvent)),
      remoteRawItemCount: survivingMappings.length,
      scope: deleteScope,
    }));

    expect(result.deleteBreakerTripped).toBe(false);
    expect(countDeletes(result)).toBe(2);
    expect(countDeletes(result)).toBeLessThan(DELETE_ABSOLUTE_FLOOR);
  });

  const approvedDeleteScope: TwoWayReconciliationScope = {
    authoritativeWindow: TEST_WINDOW,
    requestedWindow: TEST_WINDOW,
    writeBackPolicies: new Map([[
      SOURCE_CALENDAR_ID,
      createPolicy({
        deleteApproved: true,
        deleteApprovedAt: new Date(NOW.getTime() - MINUTE_MS),
        writeBackMode: "edits_and_deletes",
      }),
    ]]),
  };

  it("lets an answered bulk deletion through the breaker", () => {
    const result = classifyInboundChanges(createInput({
      ...buildMirrorSet(40, true),
      remoteEvents: [],
      remoteRawItemCount: 12,
      scope: approvedDeleteScope,
    }));

    expect(result.deleteBreakerTripped).toBe(false);
    expect(countDeletes(result)).toBe(40);
  });

  it("lets an answered deletion through a read that returned nothing at all", () => {
    const result = classifyInboundChanges(createInput({
      ...buildMirrorSet(40, true),
      remoteEvents: [],
      remoteRawItemCount: 0,
      scope: approvedDeleteScope,
    }));

    expect(countDeletes(result)).toBe(40);
    expect(result.counters.ambiguousEmptyRead).toBe(0);
  });

  it("still holds an unanswered bulk deletion after the answer expires", () => {
    const result = classifyInboundChanges(createInput({
      ...buildMirrorSet(40, true),
      remoteEvents: [],
      remoteRawItemCount: 12,
      scope: deleteScope,
    }));

    expect(result.deleteBreakerTripped).toBe(true);
    expect(countDeletes(result)).toBe(0);
  });
});

describe("classifyInboundChanges: a schedule write carries the source's all-day flag", () => {
  const ALL_DAY_START = new Date("2027-05-12T00:00:00.000Z");
  const ALL_DAY_END = new Date("2027-05-13T00:00:00.000Z");
  const MOVED_ALL_DAY_START = new Date("2027-05-13T00:00:00.000Z");
  const MOVED_ALL_DAY_END = new Date("2027-05-14T00:00:00.000Z");

  const allDayEvent = (): MaterializedSyncableEvent => createLocalEvent({
    endTime: ALL_DAY_END,
    isAllDay: true,
    startTime: ALL_DAY_START,
  });

  it("carries all-day true when an all-day mirror is moved a day", () => {
    const event = allDayEvent();
    const mapping = createMapping(event);

    expect(classificationFor(createInput({
      existingMappings: [mapping],
      localEvents: [event],
      remoteEvents: [createRemoteEvent(mapping, event, {
        endTime: MOVED_ALL_DAY_END,
        startTime: MOVED_ALL_DAY_START,
      })],
    }))).toMatchObject({
      type: "write-back",
      updates: {
        endTime: MOVED_ALL_DAY_END,
        isAllDay: true,
        startTime: MOVED_ALL_DAY_START,
      },
    });
  });

  it("carries all-day false when a timed mirror is moved", () => {
    const event = createLocalEvent();
    const mapping = createMapping(event);

    expect(classificationFor(createInput({
      remoteEvents: [createRemoteEvent(mapping, event, {
        endTime: MOVED_END_TIME,
        startTime: MOVED_START_TIME,
      })],
    }))).toMatchObject({
      type: "write-back",
      updates: { isAllDay: false },
    });
  });

  it("sends the source's own times when only the all-day flag changed", () => {
    const event = createLocalEvent();
    const mapping = createMapping(event);
    const toggled = createLocalEvent({ isAllDay: true });

    expect(classificationFor(createInput({
      remoteEvents: [createRemoteEvent(mapping, event, {
        editableContentHash: createEditableEventContentHash({ ...toggled, isAllDay: true }),
        editableFields: {
          description: "Bring the notes",
          isAllDay: true,
          location: "Room 4",
          summary: "Quarterly review",
        },
      })],
    }))).toMatchObject({
      type: "write-back",
      updates: { endTime: END_TIME, isAllDay: true, startTime: START_TIME },
    });
  });
});

describe("classifyInboundChanges: the applier is handed the state that was classified", () => {
  it("carries the source values the write-back assumes, for exactly the fields it writes", () => {
    const event = createLocalEvent();
    const mapping = createMapping(event);
    const renamed = createLocalEvent({ summary: "Quarterly review with Dana" });

    const classification = classificationFor(createInput({
      remoteEvents: [createRemoteEvent(mapping, event, {
        editableContentHash: createEditableEventContentHash(renamed),
        editableFields: {
          description: "Bring the notes",
          isAllDay: false,
          location: "Room 4",
          summary: "Quarterly review with Dana",
        },
      })],
    }));

    expect(classification).toMatchObject({
      expectedSource: { summary: "Quarterly review" },
      expectedSyncEventHash: mapping.syncEventHash,
    });
    expect(classification.expectedSource).not.toHaveProperty("startTime");
  });

  it("carries the schedule the delete assumes", () => {
    const event = createLocalEvent();

    expect(classificationFor(createInput({
      existingMappings: [createMapping(event, {
        missingFirstObservedAt: new Date(NOW.getTime() - GRACE_MS - MINUTE_MS),
        missingObservationCount: 3,
      })],
      localEvents: [event],
      now: NOW,
      remoteEvents: [],
      remoteRawItemCount: 4,
      scope: {
        authoritativeWindow: TEST_WINDOW,
        requestedWindow: TEST_WINDOW,
        writeBackPolicies: new Map([[
          SOURCE_CALENDAR_ID,
          createPolicy({ writeBackMode: "edits_and_deletes" }),
        ]]),
      },
    }))).toMatchObject({
      expectedSource: { endTime: END_TIME, isAllDay: false, startTime: START_TIME },
      type: "delete",
    });
  });
});

describe("classifyInboundChanges: a source edit outranks a mirror deletion", () => {
  const deletesScope: TwoWayReconciliationScope = {
    authoritativeWindow: TEST_WINDOW,
    requestedWindow: TEST_WINDOW,
    writeBackPolicies: new Map([[
      SOURCE_CALENDAR_ID,
      createPolicy({ writeBackMode: "edits_and_deletes" }),
    ]]),
  };

  it("refuses a matured deletion when the source event changed since our push", () => {
    const pushedEvent = createLocalEvent();
    const editedOnSource = createLocalEvent({ summary: "Renamed on the source" });
    const mapping = createMapping(pushedEvent, {
      missingFirstObservedAt: new Date(NOW.getTime() - GRACE_MS - MINUTE_MS),
      missingObservationCount: 3,
    });

    const result = classifyInboundChanges(createInput({
      existingMappings: [mapping],
      localEvents: [editedOnSource],
      remoteEvents: [],
      remoteRawItemCount: 4,
      scope: deletesScope,
    }));

    expect(countDeletes(result)).toBe(0);
    expect(result.classifications).toMatchObject([{
      resolution: "source-wins",
      type: "conflict",
    }]);
    expect(result.counters.conflictSourceWins).toBe(1);
  });

  it("hands the refused deletion back to the ordinary re-create path", () => {
    const pushedEvent = createLocalEvent();
    const editedOnSource = createLocalEvent({ summary: "Renamed on the source" });

    const result = classifyInboundChanges(createInput({
      existingMappings: [createMapping(pushedEvent, {
        missingFirstObservedAt: new Date(NOW.getTime() - GRACE_MS - MINUTE_MS),
        missingObservationCount: 3,
      })],
      localEvents: [editedOnSource],
      remoteEvents: [],
      remoteRawItemCount: 4,
      scope: deletesScope,
    }));

    expect(result.suppressedMappingIds).toEqual([]);
  });

  it("restores a recurring mirror the user deleted rather than leaving it gone", () => {
    const event = createLocalEvent();
    const result = classifyInboundChanges(createInput({
      existingMappings: [createMapping(event, {
        missingFirstObservedAt: new Date(NOW.getTime() - GRACE_MS - MINUTE_MS),
        missingObservationCount: 3,
        recurrenceRule: "FREQ=WEEKLY",
      })],
      localEvents: [event],
      remoteEvents: [],
      remoteRawItemCount: 7,
      scope: deletesScope,
    }));

    expect(countDeletes(result)).toBe(0);
    expect(result.suppressedMappingIds).toEqual([]);
    expect(result.classifications).toMatchObject([{
      reason: "recurring_event",
      type: "rejected",
    }]);
  });
});

describe("classifyInboundChanges: a breached write-back budget stays breached", () => {
  const quarantineInput = (
    mappingOverrides: Partial<TwoWayEventMapping>,
    now: Date,
  ): ClassificationInput => {
    const event = createLocalEvent();
    const mapping = createMapping(event, mappingOverrides);
    return createInput({
      existingMappings: [mapping],
      localEvents: [event],
      now,
      remoteEvents: [createRemoteEvent(mapping, event, {
        endTime: MOVED_END_TIME,
        startTime: MOVED_START_TIME,
      })],
    });
  };

  /*
   * The budget these spent went on write-backs that reached the source, which is what the
   * applier stamps writeBackLastAppliedAt with on every one of them.
   */
  it("refuses a write-back once the budget is spent inside the window", () => {
    expect(classificationFor(quarantineInput({
      writeBackEpoch: 5,
      writeBackEpochWindowStart: new Date(NOW.getTime() - 10 * MINUTE_MS),
      writeBackLastAppliedAt: new Date(NOW.getTime() - MINUTE_MS),
    }, NOW))).toMatchObject({ reason: "write_back_quarantined", type: "rejected" });
  });

  it("keeps refusing once the window has rolled past a breach", () => {
    expect(classificationFor(quarantineInput({
      writeBackEpoch: 6,
      writeBackEpochWindowStart: new Date(NOW.getTime() - 2 * HOUR_MS),
      writeBackLastAppliedAt: new Date(NOW.getTime() - HOUR_MS),
    }, NOW))).toMatchObject({ reason: "write_back_quarantined", type: "rejected" });
  });

  it("hands an unspent budget back after the window rolls", () => {
    expect(classificationFor(quarantineInput({
      writeBackEpoch: 3,
      writeBackEpochWindowStart: new Date(NOW.getTime() - 2 * HOUR_MS),
    }, NOW))).toMatchObject({ type: "write-back" });
  });
});

describe("classifyInboundChanges: a schedule write preserves the source's timezone", () => {
  const scheduleWriteFor = (
    eventOverrides: Partial<MaterializedSyncableEvent>,
  ): Record<string, unknown> => {
    const event = createLocalEvent(eventOverrides);
    const mapping = createMapping(event);
    return classificationFor(createInput({
      existingMappings: [mapping],
      localEvents: [event],
      remoteEvents: [createRemoteEvent(mapping, event, {
        endTime: MOVED_END_TIME,
        startTime: MOVED_START_TIME,
      })],
    }));
  };

  it("sends the zone the source holds so the provider cannot re-home the event", () => {
    expect(scheduleWriteFor({ startTimeZone: "America/Toronto" })).toMatchObject({
      type: "write-back",
      updates: {
        endTime: MOVED_END_TIME,
        isAllDay: false,
        startTime: MOVED_START_TIME,
        startTimeZone: "America/Toronto",
      },
    });
  });

  it("omits the zone entirely when the source holds none", () => {
    const classification = scheduleWriteFor({});
    const updates = classification["updates"] as Record<string, unknown>;

    expect(Object.hasOwn(updates, "startTimeZone")).toBe(false);
  });

  it("never carries a zone the destination reported", () => {
    const event = createLocalEvent({ startTimeZone: "Europe/Berlin" });
    const mapping = createMapping(event);
    const classification = classificationFor(createInput({
      existingMappings: [mapping],
      localEvents: [event],
      remoteEvents: [createRemoteEvent(mapping, event, {
        editableContentHash: createEditableEventContentHash({
          ...event,
          summary: "Renamed on the destination",
        }),
        editableFields: {
          description: event.description ?? "",
          isAllDay: false,
          location: event.location ?? "",
          summary: "Renamed on the destination",
        },
      })],
    }));
    const updates = classification["updates"] as Record<string, unknown>;

    expect(updates).toEqual({ summary: "Renamed on the destination" });
  });
});

describe("classifyInboundChanges: a paused mapping keeps the copies it was asked about", () => {
  const pausedScope = {
    authoritativeWindow: TEST_WINDOW,
    requestedWindow: TEST_WINDOW,
    writeBackPolicies: new Map([[SOURCE_CALENDAR_ID, createPolicy({
      paused: true,
      writeBackMode: "edits_and_deletes" as const,
    })]]),
  };

  it("suppresses the re-creation of a copy a pending confirmation is about", () => {
    const event = createLocalEvent();
    const mapping = createMapping(event, {
      missingFirstObservedAt: new Date(NOW.getTime() - GRACE_MS - MINUTE_MS),
      missingObservationCount: 3,
    });

    const result = classifyInboundChanges(createInput({
      existingMappings: [mapping],
      localEvents: [event],
      remoteEvents: [],
      remoteRawItemCount: 7,
      scope: pausedScope,
    }));

    expect(countDeletes(result)).toBe(0);
    expect(result.suppressedMappingIds).toEqual([mapping.id]);
    expect(result.classifications).toEqual([]);
  });

  it("suppresses every copy while the whole read came back empty", () => {
    const event = createLocalEvent();
    const mapping = createMapping(event, {
      missingFirstObservedAt: new Date(NOW.getTime() - GRACE_MS - MINUTE_MS),
      missingObservationCount: 3,
    });

    const result = classifyInboundChanges(createInput({
      existingMappings: [mapping],
      localEvents: [event],
      remoteEvents: [],
      remoteRawItemCount: 0,
      scope: pausedScope,
    }));

    expect(countDeletes(result)).toBe(0);
    expect(result.suppressedMappingIds).toEqual([mapping.id]);
  });

  it("writes nothing back while the pause is in force", () => {
    const event = createLocalEvent();
    const mapping = createMapping(event);

    const result = classifyInboundChanges(createInput({
      existingMappings: [mapping],
      localEvents: [event],
      remoteEvents: [createRemoteEvent(mapping, event, {
        endTime: MOVED_END_TIME,
        startTime: MOVED_START_TIME,
      })],
      scope: pausedScope,
    }));

    expect(result.classifications).toEqual([]);
  });
});
