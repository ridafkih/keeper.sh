import { describe, expect, it } from "vitest";
import { computeSyncOperations } from "../../../src/core/sync/operations";
import type { ReconciliationScope } from "../../../src/core/sync/operations";
import {
  createEditableEventContentHash,
  createSyncEventContentHash,
} from "../../../src/core/events/content-hash";
import { parseIcsCalendar } from "../../../src/ics/utils/parse-ics-calendar";
import { parseIcsEvents } from "../../../src/ics/utils/parse-ics-events";
import { isKeeperEvent } from "../../../src/core/events/identity";
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

const TEST_WINDOW = {
  timeMax: new Date("2100-01-01T00:00:00.000Z"),
  timeMin: new Date("2000-01-01T00:00:00.000Z"),
};

const ONE_WAY_SCOPE: ReconciliationScope = {
  authoritativeWindow: TEST_WINDOW,
  requestedWindow: TEST_WINDOW,
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

type TwoWayReconciliationScope = ReconciliationScope & {
  writeBackPolicies?: ReadonlyMap<string, WriteBackPolicy>;
};

const createLocalEvent = (
  overrides: Partial<MaterializedSyncableEvent> = {},
): MaterializedSyncableEvent => ({
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

const createEventMapping = (
  event: MaterializedSyncableEvent,
  overrides: Partial<EventMapping> = {},
): EventMapping => ({
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier: "destination-delete-id-1",
  destinationEventUid: "destination-uid-1",
  endTime: event.endTime,
  eventStateId: event.eventStateId ?? event.id,
  id: "mapping-id-1",
  sourceCalendarId: SOURCE_CALENDAR_ID,
  startTime: event.startTime,
  syncEventHash: createSyncEventContentHash(event),
  syncEventId: event.id,
  ...overrides,
});

const createRemoteEvent = (
  mapping: EventMapping,
  event: MaterializedSyncableEvent,
  overrides: Partial<RemoteEvent> = {},
): RemoteEvent => ({
  deleteId: mapping.deleteIdentifier,
  editableAvailability: "busy" as EventAvailability,
  editableContentHash: createEditableEventContentHash(event),
  endTime: mapping.endTime,
  isKeeperEvent: true,
  startTime: mapping.startTime,
  supportedAvailabilities: ["busy", "free"] as EventAvailability[],
  uid: mapping.destinationEventUid,
  ...overrides,
});

const createPolicyMap = (
  writeBackMode: WriteBackPolicy["writeBackMode"],
  sourceCalendarId = SOURCE_CALENDAR_ID,
): ReadonlyMap<string, WriteBackPolicy> => new Map([[sourceCalendarId, {
  deleteApproved: false,
  destinationCalendarId: DESTINATION_CALENDAR_ID,
  excludeEventDescription: false,
  excludeEventLocation: false,
  excludeEventName: false,
  paused: false,
  sourceCalendarId,
  writeBackMode,
}]]);

const withPolicies = (
  policies: ReadonlyMap<string, WriteBackPolicy>,
): TwoWayReconciliationScope => ({ ...ONE_WAY_SCOPE, writeBackPolicies: policies });

interface BaselineCase {
  localEvents: MaterializedSyncableEvent[];
  mappings: EventMapping[];
  name: string;
  remoteEvents: RemoteEvent[];
}

const buildBaselineCases = (): BaselineCase[] => {
  const event = createLocalEvent();
  const mapping = createEventMapping(event);
  const editedEvent = createLocalEvent({ summary: "Renamed on the destination" });

  return [
    {
      localEvents: [event],
      mappings: [mapping],
      name: "in sync",
      remoteEvents: [createRemoteEvent(mapping, event)],
    },
    {
      localEvents: [event],
      mappings: [mapping],
      name: "remote content changed",
      remoteEvents: [createRemoteEvent(mapping, event, {
        editableContentHash: createEditableEventContentHash(editedEvent),
      })],
    },
    {
      localEvents: [event],
      mappings: [mapping],
      name: "remote time changed",
      remoteEvents: [createRemoteEvent(mapping, event, {
        endTime: new Date("2027-05-11T18:00:00.000Z"),
        startTime: new Date("2027-05-11T17:00:00.000Z"),
      })],
    },
    {
      localEvents: [event],
      mappings: [mapping],
      name: "remote availability changed",
      remoteEvents: [createRemoteEvent(mapping, event, { editableAvailability: "free" })],
    },
    {
      localEvents: [event],
      mappings: [mapping],
      name: "remote missing",
      remoteEvents: [],
    },
    {
      localEvents: [],
      mappings: [mapping],
      name: "local missing",
      remoteEvents: [createRemoteEvent(mapping, event)],
    },
    {
      localEvents: [event],
      mappings: [mapping],
      name: "unmapped non keeper remote event present",
      remoteEvents: [
        createRemoteEvent(mapping, event),
        createRemoteEvent(mapping, event, {
          deleteId: "user-owned-delete-id",
          isKeeperEvent: false,
          uid: "user-owned-uid",
        }),
      ],
    },
    {
      localEvents: [createLocalEvent({ summary: "Source side rename" })],
      mappings: [mapping],
      name: "local hash changed",
      remoteEvents: [createRemoteEvent(mapping, event)],
    },
  ];
};

describe("one-way mappings are untouched by two-way sync", () => {
  it.each(buildBaselineCases())(
    "produces identical operations with and without an unrelated write-back policy: $name",
    ({ localEvents, mappings, remoteEvents }) => {
      const baseline = computeSyncOperations(
        localEvents,
        mappings,
        remoteEvents,
        ONE_WAY_SCOPE,
      );
      const withUnrelatedPolicy = computeSyncOperations(
        localEvents,
        mappings,
        remoteEvents,
        withPolicies(createPolicyMap("edits", "a-different-source-calendar")),
      );
      const withDisabledPolicy = computeSyncOperations(
        localEvents,
        mappings,
        remoteEvents,
        withPolicies(createPolicyMap("off")),
      );

      expect(withUnrelatedPolicy).toEqual(baseline);
      expect(withDisabledPolicy).toEqual(baseline);
    },
  );

  it("still replaces the mirror when the destination is edited and write-back is off", () => {
    const event = createLocalEvent();
    const mapping = createEventMapping(event);
    const remoteEvent = createRemoteEvent(mapping, event, {
      editableContentHash: createEditableEventContentHash(
        createLocalEvent({ summary: "Renamed by the user on the destination" }),
      ),
    });

    const result = computeSyncOperations(
      [event],
      [mapping],
      [remoteEvent],
      withPolicies(createPolicyMap("off")),
    );

    expect(result.staleMappingIds).toEqual([mapping.id]);
    expect(result.staleReasonCounts.remoteContentChanged).toBe(1);
    expect(result.operations).toEqual([{
      deleteId: mapping.deleteIdentifier,
      event,
      staleMappingId: mapping.id,
      type: "replace",
      uid: mapping.destinationEventUid,
    }]);
  });

  it("never deletes an unmapped remote event Keeper.sh did not create", () => {
    const event = createLocalEvent();
    const mapping = createEventMapping(event);
    const userOwnedRemoteEvent = createRemoteEvent(mapping, event, {
      deleteId: "user-owned-delete-id",
      isKeeperEvent: false,
      uid: "user-owned-uid",
    });

    const result = computeSyncOperations(
      [event],
      [mapping],
      [createRemoteEvent(mapping, event), userOwnedRemoteEvent],
      withPolicies(createPolicyMap("edits_and_deletes")),
    );

    expect(result.operations.filter((operation) => operation.type === "remove")).toEqual([]);
  });
});

const createIcsString = (): string => [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Keeper Test//EN",
    "BEGIN:VEVENT",
    "UID:a-real-user-event",
    "DTSTART:20270511T140000Z",
    "DTEND:20270511T150000Z",
    "SUMMARY:Quarterly review",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:0123456789abcdef0123456789abcdef@keeper.sh",
    "DTSTART:20270511T160000Z",
    "DTEND:20270511T170000Z",
    "SUMMARY:Mirrored copy",
    "END:VEVENT",
    "END:VCALENDAR",
].join("\r\n");

describe("keeper events stay filtered out of source ingest", () => {
  it("drops mirrored copies on ingest with no way to opt a source calendar out", () => {
    const calendar = parseIcsCalendar({ icsString: createIcsString() });

    expect(parseIcsEvents(calendar).map((event) => event.uid)).toEqual(["a-real-user-event"]);
    expect(parseIcsEvents(calendar, { includeKeeperEvents: true }).map((event) => event.uid))
      .toEqual(["a-real-user-event", "0123456789abcdef0123456789abcdef@keeper.sh"]);
  });

  it("recognizes a mirrored uid and leaves a Keeper-created user event ingestible", () => {
    expect(isKeeperEvent("0123456789abcdef0123456789abcdef@keeper.sh")).toBe(true);
    expect(isKeeperEvent("0123456789abcdef0123456789abcdef@user.keeper.sh")).toBe(false);
  });
});
