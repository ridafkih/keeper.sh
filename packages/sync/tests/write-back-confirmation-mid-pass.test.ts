import { describe, expect, it } from "vitest";
import { TWO_WAY_EPOCH_QUARANTINE_LIMIT } from "@keeper.sh/calendar";
import type {
  CalendarSourceWriter,
  InboundClassification,
  RemoteEventPresence,
} from "@keeper.sh/calendar";
import { runWriteBackPass } from "../src/write-back-pass";
import type {
  LockedWriteBackStore,
  SourceEventSnapshot,
  WriteBackStore,
  WriteBackTarget,
} from "../src/write-back-pass";

const SOURCE_CALENDAR_ID = "source-calendar-id";
const OTHER_SOURCE_CALENDAR_ID = "other-source-calendar-id";
const DESTINATION_CALENDAR_ID = "destination-calendar-id";
const BLOCKED_MAPPING_ID = "mapping-blocked";
const DOOMED_MAPPING_ID = "mapping-doomed";
const SIBLING_MAPPING_ID = "mapping-sibling-pair";
const START_TIME = new Date("2027-05-11T14:00:00.000Z");
const END_TIME = new Date("2027-05-11T15:00:00.000Z");
const PUSHED_HASH = "the-hash-of-what-we-last-pushed";
const ONE_SHORT_OF_QUARANTINE = TWO_WAY_EPOCH_QUARANTINE_LIMIT - 1;

const createSourceEvent = (): SourceEventSnapshot => ({
  description: "Bring the notes",
  endTime: END_TIME,
  isAllDay: null,
  location: "Room 4",
  startTime: START_TIME,
  startTimeZone: null,
  title: "Quarterly review",
});

const SOURCE_CALENDAR_IDS_BY_MAPPING = new Map([
  [SIBLING_MAPPING_ID, OTHER_SOURCE_CALENDAR_ID],
]);

const PRESENCE_BY_MAPPING = new Map<string, RemoteEventPresence>([
  [BLOCKED_MAPPING_ID, "present"],
]);

const createTarget = (
  mappingId: string,
  sourceCalendarId = SOURCE_CALENDAR_ID,
): WriteBackTarget => ({
  destinationCalendarId: DESTINATION_CALENDAR_ID,
  eventStateId: `event-state-${mappingId}`,
  mappingId,
  sourceCalendarId,
  sourceEventId: null,
  sourceEventUid: `source-event-uid-${mappingId}`,
});

const createDelete = (mappingId: string): InboundClassification => ({
  expectedSource: {
    description: "Bring the notes",
    endTime: END_TIME,
    isAllDay: false,
    location: "Room 4",
    startTime: START_TIME,
    summary: "Quarterly review",
  },
  expectedSyncEventHash: PUSHED_HASH,
  mappingId,
  sourceEventUid: `source-event-uid-${mappingId}`,
  type: "delete",
});

const createHarness = () => {
  const deleted: string[] = [];
  const confirmations: { reason: string; sourceCalendarId: string }[] = [];
  const quarantines: { reason: string; sourceCalendarId: string }[] = [];
  const state = { epoch: ONE_SHORT_OF_QUARANTINE };

  const writer: CalendarSourceWriter = {
    deleteEvent: (reference) => {
      deleted.push(reference.sourceEventUid);
      return Promise.resolve({ success: true });
    },
    updateEvent: () => Promise.resolve({ success: true }),
  };

  const locked: LockedWriteBackStore = {
    commitDelete: () => Promise.resolve(),
    commitUpdate: () => {
      state.epoch += 1;
      return Promise.resolve({ writeBackEpoch: state.epoch });
    },
    readMappingSyncEventHash: () => Promise.resolve({ syncEventHash: PUSHED_HASH }),
    readPairWriteBack: () =>
      Promise.resolve({ writeBackMode: "edits_and_deletes", writeBackState: "ok" }),
    readSourceEvent: () => Promise.resolve(createSourceEvent()),
  };

  const store: WriteBackStore = {
    abandonTombstone: () => Promise.resolve(),
    countRecentDeletes: () => Promise.resolve(0),
    loadTarget: (mappingId) =>
      Promise.resolve(createTarget(mappingId, SOURCE_CALENDAR_IDS_BY_MAPPING.get(mappingId))),
    notifySiblings: () => Promise.resolve(),
    probeDestinationEvent: (target) =>
      Promise.resolve(PRESENCE_BY_MAPPING.get(target.mappingId) ?? "absent"),
    quarantineMapping: (sourceCalendarId, _destinationCalendarId, reason) => {
      quarantines.push({ reason, sourceCalendarId });
      return Promise.resolve();
    },
    readSourceEvent: () => Promise.resolve(createSourceEvent()),
    recordFailure: () => {
      state.epoch += 1;
      return Promise.resolve(state.epoch);
    },
    recordTombstone: () => Promise.resolve({ id: "tombstone-1", observedAt: new Date(), priorAttempt: false }),
    requestDeleteConfirmation: (sourceCalendarId, _destinationCalendarId, reason) => {
      confirmations.push({ reason, sourceCalendarId });
      return Promise.resolve();
    },
    resolveWriter: () => Promise.resolve(writer),
    withSourceLock: (_sourceCalendarId, run) => run(locked),
  };

  return { confirmations, deleted, quarantines, store };
};

describe("a pair paused mid-pass for a delete confirmation stops being written to", () => {
  it("destroys nothing on the source after asking the user about the same pair", async () => {
    const harness = createHarness();

    await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications: [createDelete(BLOCKED_MAPPING_ID), createDelete(DOOMED_MAPPING_ID)],
      store: harness.store,
    });

    expect(harness.confirmations).toEqual([
      { reason: "delete_probe_blocked", sourceCalendarId: SOURCE_CALENDAR_ID },
    ]);
    expect(harness.deleted).toEqual([]);
  });

  it("leaves a different pair on the same destination working", async () => {
    const harness = createHarness();

    await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications: [
        createDelete(BLOCKED_MAPPING_ID),
        createDelete(DOOMED_MAPPING_ID),
        createDelete(SIBLING_MAPPING_ID),
      ],
      store: harness.store,
    });

    expect(harness.deleted).toEqual([`source-event-uid-${SIBLING_MAPPING_ID}`]);
  });
});
