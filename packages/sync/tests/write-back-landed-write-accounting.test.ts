import { describe, expect, it } from "vitest";
import type { CalendarSourceWriter, InboundClassification } from "@keeper.sh/calendar";
import { TWO_WAY_EPOCH_QUARANTINE_LIMIT } from "@keeper.sh/calendar";
import { runWriteBackPass } from "../src/write-back-pass";
import type {
  LockedWriteBackStore,
  SourceEventSnapshot,
  WriteBackStore,
  WriteBackTarget,
} from "../src/write-back-pass";

const SOURCE_CALENDAR_ID = "source-calendar-id";
const DESTINATION_CALENDAR_ID = "destination-calendar-id";
const MAPPING_ID = "mapping-id-1";
const EVENT_STATE_ID = "event-state-id-1";
const SOURCE_EVENT_UID = "source-event-uid-1";
const START_TIME = new Date("2027-05-11T14:00:00.000Z");
const END_TIME = new Date("2027-05-11T15:00:00.000Z");
const PUSHED_HASH = "the-hash-of-what-we-last-pushed";
const NOW = new Date("2027-05-01T09:00:00.000Z");

const createSourceEvent = (): SourceEventSnapshot => ({
  description: "Bring the notes",
  endTime: END_TIME,
  isAllDay: null,
  location: "Room 4",
  startTime: START_TIME,
  startTimeZone: null,
  title: "Quarterly review",
});

const createTarget = (): WriteBackTarget => ({
  destinationCalendarId: DESTINATION_CALENDAR_ID,
  eventStateId: EVENT_STATE_ID,
  mappingId: MAPPING_ID,
  sourceCalendarId: SOURCE_CALENDAR_ID,
  sourceEventId: null,
  sourceEventUid: SOURCE_EVENT_UID,
});

const createWriteBack = (): InboundClassification => ({
  expectedSource: { endTime: END_TIME, isAllDay: false, startTime: START_TIME },
  expectedSyncEventHash: PUSHED_HASH,
  mappingId: MAPPING_ID,
  observed: {
    availability: "busy",
    contentHash: "observed-content-hash",
    description: "Bring the notes",
    endTime: END_TIME,
    isAllDay: false,
    location: "Room 4",
    startTime: START_TIME,
    summary: "Edited on the copy",
  },
  projectedSyncEventHash: "projected-hash",
  sourceEventUid: SOURCE_EVENT_UID,
  type: "write-back",
  updates: { summary: "Edited on the copy" },
});

/*
 * The write below is the one that trips the runaway stop: it reaches the real calendar
 * and only then does the pair quarantine. Everything downstream of the pass is entitled
 * to know a source event was modified.
 */
const createHarness = () => {
  const notifiedSiblings: string[] = [];
  const quarantines: string[] = [];
  const writerCalls: string[] = [];

  const writer: CalendarSourceWriter = {
    deleteEvent: () => Promise.resolve({ success: true }),
    updateEvent: () => {
      writerCalls.push("update");
      return Promise.resolve({ success: true });
    },
  };

  const locked: LockedWriteBackStore = {
    commitDelete: () => Promise.resolve(),
    commitUpdate: () =>
      Promise.resolve({
        writeBackDailyCount: 1,
        writeBackEpoch: TWO_WAY_EPOCH_QUARANTINE_LIMIT,
      }),
    readMappingSyncEventHash: () => Promise.resolve({ syncEventHash: PUSHED_HASH }),
    readPairWriteBack: () =>
      Promise.resolve({ writeBackMode: "edits_and_deletes", writeBackState: "ok" }),
    readSourceEvent: () => Promise.resolve(createSourceEvent()),
  };

  const store: WriteBackStore = {
    abandonTombstone: () => Promise.resolve(),
    countRecentDeletes: () => Promise.resolve(0),
    loadTarget: () => Promise.resolve(createTarget()),
    notifySiblings: (sourceCalendarId) => {
      notifiedSiblings.push(sourceCalendarId);
      return Promise.resolve();
    },
    quarantineMapping: (_source, _destination, reason) => {
      quarantines.push(reason);
      return Promise.resolve();
    },
    readSourceEvent: () => Promise.resolve(createSourceEvent()),
    recordFailure: () => Promise.resolve(0),
    recordTombstone: () =>
      Promise.resolve({ id: "tombstone-1", observedAt: NOW, priorAttempt: false }),
    resolveWriter: () => Promise.resolve(writer),
    withSourceLock: (_sourceCalendarId, run) => run(locked),
  };

  return {
    notifiedSiblings,
    quarantines,
    run: () =>
      runWriteBackPass({
        calendarId: DESTINATION_CALENDAR_ID,
        classifications: [createWriteBack()],
        now: () => NOW,
        store,
      }),
    writerCalls,
  };
};

describe("a write-back that lands and then trips the runaway stop", () => {
  it("still reports that a source event was written", async () => {
    const harness = createHarness();
    const result = await harness.run();

    expect(harness.writerCalls).toEqual(["update"]);
    expect(harness.quarantines).toEqual(["runaway_write_back"]);
    expect(result.applied).toBe(1);
  });

  it("still wakes the other destinations mirroring that source", async () => {
    const harness = createHarness();
    await harness.run();

    expect(harness.writerCalls).toEqual(["update"]);
    expect(harness.notifiedSiblings).toEqual([SOURCE_CALENDAR_ID]);
  });
});
