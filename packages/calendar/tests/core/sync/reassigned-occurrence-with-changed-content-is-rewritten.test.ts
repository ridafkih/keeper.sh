import { describe, expect, it } from "vitest";
import { computeSyncOperations } from "../../../src/core/sync/operations";
import type { ReconciliationScope } from "../../../src/core/sync/operations";
import {
  createEditableEventContentSnapshot,
  createSyncEventContentHash,
  hashEditableEventContentSnapshot,
} from "../../../src/core/events/content-hash";
import { materializeRecurrenceEvents } from "../../../src/core/events/recurrence-materializer";
import type { EventMapping } from "../../../src/core/events/mappings";
import type { MaterializedSyncableEvent, RemoteEvent, SyncableEvent } from "../../../src/core/types";

const SOURCE_CALENDAR_ID = "source-calendar-id";
const DESTINATION_CALENDAR_ID = "destination-calendar-id";
const SERIES_STATE_ID = "event-state-series-1";

const WINDOW = {
  end: new Date("2026-04-20T00:00:00.000Z"),
  start: new Date("2026-03-01T00:00:00.000Z"),
};

const SCOPE: ReconciliationScope = {
  authoritativeWindow: { timeMax: WINDOW.end, timeMin: WINDOW.start },
  requestedWindow: { timeMax: WINDOW.end, timeMin: WINDOW.start },
};

/* The two saves a "this and following" rename produces: the anchor moves forward one
 * weekly interval and the title changes in the same write. */
const createMaster = (overrides: Partial<SyncableEvent>): SyncableEvent => ({
  calendarId: SOURCE_CALENDAR_ID,
  calendarName: "Source",
  calendarUrl: null,
  description: "agenda",
  endTime: new Date("2026-03-02T15:00:00.000Z"),
  eventStateId: SERIES_STATE_ID,
  id: SERIES_STATE_ID,
  location: "Room 1",
  recurrenceRule: { count: 7, frequency: "WEEKLY" },
  sourceEventUid: "series-source-uid",
  startTime: new Date("2026-03-02T14:00:00.000Z"),
  summary: "Team sync",
  ...overrides,
});

const materialize = (master: SyncableEvent): MaterializedSyncableEvent[] =>
  materializeRecurrenceEvents([master], WINDOW);

interface ProviderShape {
  name: string;
  createUid: (index: number) => string;
  createDeleteId: (index: number) => string;
}

/* CalDAV addresses the object by path; Google and Outlook hand back an opaque id that is
 * never the uid, so a CalDAV-only fixture cannot stand in for them. */
const PROVIDER_SHAPES: ProviderShape[] = [
  {
    createDeleteId: (index) => `/calendars/testuser/destination/keeper-occurrence-${index}.ics`,
    createUid: (index) => `keeper-occurrence-${index}@example.invalid`,
    name: "caldav",
  },
  {
    createDeleteId: (index) => `google-event-id-${index}`,
    createUid: (index) => `keeper-occurrence-${index}@example.invalid`,
    name: "google",
  },
  {
    createDeleteId: (index) => `outlook-event-id-${index}`,
    createUid: (index) => `keeper-occurrence-${index}@example.invalid`,
    name: "outlook",
  },
];

interface ScenarioOptions {
  shape: ProviderShape;
  recordBaseline: boolean;
  privateOverrides?: Partial<SyncableEvent>;
}

interface Scenario {
  localEvents: MaterializedSyncableEvent[];
  mappings: EventMapping[];
  remoteEvents: RemoteEvent[];
  survivors: MaterializedSyncableEvent[];
}

const baselineHashFor = (recordBaseline: boolean, mirroredHash: string): string | null => {
  if (recordBaseline) {
    return mirroredHash;
  }

  return null;
};

const buildScenario = ({
  privateOverrides = {},
  recordBaseline,
  shape,
}: ScenarioOptions): Scenario => {
  const before = materialize(createMaster({}));
  const after = materialize(createMaster({
    endTime: new Date("2026-03-09T15:00:00.000Z"),
    recurrenceRule: { count: 6, frequency: "WEEKLY" },
    startTime: new Date("2026-03-09T14:00:00.000Z"),
    summary: "Quarterly planning",
    ...privateOverrides,
  }));

  const mappings: EventMapping[] = [];
  const remoteEvents: RemoteEvent[] = [];
  for (const [index, occurrence] of before.entries()) {
    const mirroredContent = createEditableEventContentSnapshot(occurrence);
    const mirroredHash = hashEditableEventContentSnapshot(mirroredContent);
    const uid = shape.createUid(index);
    const deleteId = shape.createDeleteId(index);
    mappings.push({
      calendarId: DESTINATION_CALENDAR_ID,
      deleteIdentifier: deleteId,
      destinationEventUid: uid,
      endTime: occurrence.endTime,
      eventStateId: SERIES_STATE_ID,
      id: `mapping-${index}`,
      remoteAvailability: null,
      remoteContentHash: baselineHashFor(recordBaseline, mirroredHash),
      remoteEndTime: null,
      remoteStartTime: null,
      sourceCalendarId: SOURCE_CALENDAR_ID,
      startTime: occurrence.startTime,
      syncEventHash: createSyncEventContentHash(occurrence),
      syncEventId: occurrence.id,
    });
    remoteEvents.push({
      deleteId,
      editableAvailability: "busy",
      editableContent: mirroredContent,
      editableContentHash: mirroredHash,
      endTime: occurrence.endTime,
      isKeeperEvent: true,
      startTime: occurrence.startTime,
      supportedAvailabilities: ["busy", "free"],
      uid,
    });
  }

  return { localEvents: after, mappings, remoteEvents, survivors: after };
};

const findReplacedEventIds = (
  result: ReturnType<typeof computeSyncOperations>,
): Set<string> => {
  const replaced = new Set<string>();
  for (const operation of result.operations) {
    if (operation.type !== "replace") {
      continue;
    }
    replaced.add(operation.event.id);
  }
  return replaced;
};

const findWrittenSummaries = (
  result: ReturnType<typeof computeSyncOperations>,
): string[] => {
  const summaries: string[] = [];
  for (const operation of result.operations) {
    if (operation.type === "remove") {
      continue;
    }
    summaries.push(operation.event.summary);
  }
  return summaries;
};

describe("reassigned occurrence with changed content is rewritten", () => {
  for (const shape of PROVIDER_SHAPES) {
    it(`rewrites every surviving ${shape.name} occurrence when no baseline was recorded`, () => {
      const scenario = buildScenario({ recordBaseline: false, shape });

      const result = computeSyncOperations(
        scenario.localEvents,
        scenario.mappings,
        scenario.remoteEvents,
        SCOPE,
      );

      const replaced = findReplacedEventIds(result);
      expect(scenario.survivors).toHaveLength(6);
      for (const occurrence of scenario.survivors) {
        expect(replaced).toContain(occurrence.id);
      }
    });

    it(`rewrites every surviving ${shape.name} occurrence when a baseline was recorded`, () => {
      const scenario = buildScenario({ recordBaseline: true, shape });

      const result = computeSyncOperations(
        scenario.localEvents,
        scenario.mappings,
        scenario.remoteEvents,
        SCOPE,
      );

      const replaced = findReplacedEventIds(result);
      expect(scenario.survivors).toHaveLength(6);
      for (const occurrence of scenario.survivors) {
        expect(replaced).toContain(occurrence.id);
      }
    });

    it(`sends the masked ${shape.name} title to the destination when the series is renamed`, () => {
      const scenario = buildScenario({
        privateOverrides: { isPrivate: true, summary: "Busy" },
        recordBaseline: true,
        shape,
      });

      const result = computeSyncOperations(
        scenario.localEvents,
        scenario.mappings,
        scenario.remoteEvents,
        SCOPE,
      );

      const replaced = findReplacedEventIds(result);
      for (const occurrence of scenario.survivors) {
        expect(replaced).toContain(occurrence.id);
      }
      expect(findWrittenSummaries(result)).toEqual(Array.from({ length: 6 }, () => "Busy"));
    });
  }
});
