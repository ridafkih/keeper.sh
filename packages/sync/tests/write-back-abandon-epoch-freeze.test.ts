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
const DESTINATION_CALENDAR_ID = "destination-calendar-id";
const MAPPING_ID = "mapping-id-1";
const EVENT_STATE_ID = "event-state-id-1";
const SOURCE_EVENT_UID = "source-event-uid-1";
const START_TIME = new Date("2027-05-11T14:00:00.000Z");
const END_TIME = new Date("2027-05-11T15:00:00.000Z");
const PUSHED_HASH = "the-hash-of-what-we-last-pushed";
const NONE = 0;
const ONE = 1;

const SOURCE_EVENT: SourceEventSnapshot = {
  description: null,
  endTime: END_TIME,
  isAllDay: null,
  location: null,
  startTime: START_TIME,
  startTimeZone: null,
  title: null,
};

const createTarget = (): WriteBackTarget => ({
  deleteIdentifier: "mirror-1",
  destinationCalendarId: DESTINATION_CALENDAR_ID,
  destinationEventUid: "mirror-1",
  eventStateId: EVENT_STATE_ID,
  mappingId: MAPPING_ID,
  sourceCalendarId: SOURCE_CALENDAR_ID,
  sourceEventId: null,
  sourceEventUid: SOURCE_EVENT_UID,
});

/*
 * The source event moved between the classifier reading it and the applier taking the
 * lock, so the guard abandons the write rather than overwriting a change it never saw.
 */
const createAbandonedHarness = () => {
  const quarantines: string[] = [];
  const writerCalls: string[] = [];
  const state = { epoch: NONE };

  const writer: CalendarSourceWriter = {
    deleteEvent: () => {
      writerCalls.push("delete");
      return Promise.resolve({ success: true });
    },
    updateEvent: () => {
      writerCalls.push("update");
      return Promise.resolve({ success: true });
    },
  };

  const locked: LockedWriteBackStore = {
    commitDelete: () => Promise.resolve(),
    commitUpdate: () => Promise.resolve({ writeBackEpoch: ONE }),
    readMappingSyncEventHash: () => Promise.resolve({ syncEventHash: PUSHED_HASH }),
    readPairWriteBack: () =>
      Promise.resolve({ writeBackMode: "edits_and_deletes", writeBackState: "ok" }),
    readSourceEvent: () =>
      Promise.resolve({ ...SOURCE_EVENT, title: "Moved on since we classified it" }),
  };

  const store: WriteBackStore = {
    abandonTombstone: () => Promise.resolve(),
    countRecentDeletes: () => Promise.resolve(NONE),
    loadTarget: () => Promise.resolve(createTarget()),
    notifySiblings: () => Promise.resolve(),
    probeDestinationEvent: () => Promise.resolve("present"),
    quarantineMapping: (_source, _destination, reason) => {
      quarantines.push(reason);
      return Promise.resolve();
    },
    readSourceEvent: () => Promise.resolve(SOURCE_EVENT),
    recordFailure: () => {
      state.epoch += ONE;
      return Promise.resolve(state.epoch);
    },
    recordTombstone: () => Promise.resolve({ id: "tombstone-1", observedAt: new Date(), priorAttempt: false }),
    requestDeleteConfirmation: () => Promise.resolve(),
    resolveWriter: () => Promise.resolve(writer),
    withSourceLock: (_sourceCalendarId, run) => run(locked),
  };

  return { quarantines, state, store, writerCalls };
};

const createWriteBack = (): InboundClassification => ({
  expectedSource: { summary: "Busy" },
  expectedSyncEventHash: PUSHED_HASH,
  mappingId: MAPPING_ID,
  observed: {
    availability: "busy",
    contentHash: "observed-content-hash",
    description: "",
    endTime: END_TIME,
    isAllDay: false,
    location: "",
    startTime: START_TIME,
    summary: "Dentist",
  },
  projectedSyncEventHash: "projected-hash",
  sourceEventUid: SOURCE_EVENT_UID,
  type: "write-back",
  updates: { summary: "Dentist" },
});

describe("a write-back abandoned until its epoch budget is gone", () => {
  it("reverts the pair to one-way rather than freezing the mapping silently", async () => {
    const harness = createAbandonedHarness();

    for (let pass = NONE; pass < TWO_WAY_EPOCH_QUARANTINE_LIMIT; pass += ONE) {
      await runWriteBackPass({
        calendarId: DESTINATION_CALENDAR_ID,
        classifications: [createWriteBack()],
        store: harness.store,
      });
    }

    expect(harness.writerCalls).toEqual([]);
    expect(harness.state.epoch).toBe(TWO_WAY_EPOCH_QUARANTINE_LIMIT);
    expect(harness.quarantines).toContain("runaway_write_back");
  });
});
