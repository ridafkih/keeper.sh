import { describe, expect, it } from "vitest";
import { TWO_WAY_EPOCH_QUARANTINE_LIMIT } from "@keeper.sh/calendar";
import type { CalendarSourceWriter, InboundClassification } from "@keeper.sh/calendar";
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
const RUNAWAY_MAPPING_ID = "mapping-runaway";
const DOOMED_MAPPING_ID = "mapping-doomed";
const SIBLING_MAPPING_ID = "mapping-sibling-pair";
const START_TIME = new Date("2027-05-11T14:00:00.000Z");
const END_TIME = new Date("2027-05-11T15:00:00.000Z");
const MOVED_START_TIME = new Date("2027-05-11T17:00:00.000Z");
const MOVED_END_TIME = new Date("2027-05-11T18:00:00.000Z");
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

const createWriteBack = (mappingId: string): InboundClassification => ({
  expectedSource: { endTime: END_TIME, isAllDay: false, startTime: START_TIME },
  expectedSyncEventHash: PUSHED_HASH,
  mappingId,
  observed: {
    availability: "busy",
    contentHash: "observed-content-hash",
    description: "Bring the notes",
    endTime: MOVED_END_TIME,
    isAllDay: false,
    location: "Room 4",
    startTime: MOVED_START_TIME,
    summary: "Quarterly review",
  },
  projectedSyncEventHash: "projected-hash",
  sourceEventUid: `source-event-uid-${mappingId}`,
  type: "write-back",
  updates: { endTime: MOVED_END_TIME, isAllDay: false, startTime: MOVED_START_TIME },
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

interface HarnessOptions {
  startingEpoch?: number;
  writerFailure?: string;
}

const createHarness = (options: HarnessOptions = {}) => {
  const deleted: string[] = [];
  const updated: string[] = [];
  const quarantines: { reason: string; sourceCalendarId: string }[] = [];
  const state = { epoch: options.startingEpoch ?? 0 };

  const writer: CalendarSourceWriter = {
    deleteEvent: (reference) => {
      if (options.writerFailure) {
        return Promise.resolve({ error: options.writerFailure, success: false });
      }
      deleted.push(reference.sourceEventUid);
      return Promise.resolve({ success: true });
    },
    updateEvent: (reference) => {
      if (options.writerFailure) {
        return Promise.resolve({ error: options.writerFailure, success: false });
      }
      updated.push(reference.sourceEventUid);
      return Promise.resolve({ success: true });
    },
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
    probeDestinationEvent: () => Promise.resolve("absent"),
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
    resolveWriter: () => Promise.resolve(writer),
    withSourceLock: (_sourceCalendarId, run) => run(locked),
  };

  return { deleted, quarantines, store, updated };
};

describe("a pair quarantined mid-pass stops being written to for the rest of the pass", () => {
  it("destroys nothing more on the source after a runaway quarantine", async () => {
    const harness = createHarness({ startingEpoch: ONE_SHORT_OF_QUARANTINE });

    const result = await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications: [
        createWriteBack(RUNAWAY_MAPPING_ID),
        createDelete(DOOMED_MAPPING_ID),
      ],
      store: harness.store,
    });

    expect(harness.quarantines).toEqual([
      { reason: "runaway_write_back", sourceCalendarId: SOURCE_CALENDAR_ID },
    ]);
    expect(harness.deleted).toEqual([]);
    /*
     * The runaway write-back reached the real calendar before the stop fired, so the pass
     * reports one applied write beside the quarantine. What the quarantine has to stop is
     * everything after it, which the empty delete list above is the assertion for.
     */
    expect(harness.updated).toHaveLength(1);
    expect(result.applied).toBe(1);
  });

  it("writes nothing more on the source after a repeated-failure quarantine", async () => {
    const harness = createHarness({
      startingEpoch: ONE_SHORT_OF_QUARANTINE,
      writerFailure: "the provider refused",
    });

    await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications: [
        createWriteBack(RUNAWAY_MAPPING_ID),
        createDelete(DOOMED_MAPPING_ID),
      ],
      store: harness.store,
    });

    expect(harness.quarantines).toEqual([
      { reason: "write_back_failing", sourceCalendarId: SOURCE_CALENDAR_ID },
    ]);
    expect(harness.deleted).toEqual([]);
  });

  it("leaves a different pair on the same destination working", async () => {
    const harness = createHarness({ startingEpoch: ONE_SHORT_OF_QUARANTINE });

    await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications: [
        createWriteBack(RUNAWAY_MAPPING_ID),
        createDelete(DOOMED_MAPPING_ID),
        createDelete(SIBLING_MAPPING_ID),
      ],
      store: harness.store,
    });

    expect(harness.deleted).toEqual([`source-event-uid-${SIBLING_MAPPING_ID}`]);
  });
});
