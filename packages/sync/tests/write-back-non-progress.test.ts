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
const REPEATED_PASS_COUNT = 8;

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

interface NonProgressHarnessOptions {
  presence?: "absent" | "present";
  sourceEvent: SourceEventSnapshot;
}

const createNonProgressHarness = (options: NonProgressHarnessOptions) => {
  const confirmations: { reason: string }[] = [];
  const quarantines: { reason: string }[] = [];
  const writerCalls: string[] = [];
  const state = { epoch: 0 };

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
    commitUpdate: () => Promise.resolve({ writeBackAppliedCount: 1 }),
    readMappingSyncEventHash: () => Promise.resolve({ syncEventHash: PUSHED_HASH }),
    readPairWriteBack: () =>
      Promise.resolve({ writeBackMode: "edits_and_deletes", writeBackState: "ok" }),
    readSourceEvent: () => Promise.resolve(options.sourceEvent),
  };

  const store: WriteBackStore = {
    abandonTombstone: () => Promise.resolve(),
    countRecentDeletes: () => Promise.resolve(0),
    loadTarget: () => Promise.resolve(createTarget()),
    notifySiblings: () => Promise.resolve(),
    probeDestinationEvent: () => Promise.resolve(options.presence ?? "present"),
    quarantineMapping: (_source, _destination, reason) => {
      quarantines.push({ reason });
      return Promise.resolve();
    },
    readSourceEvent: () => Promise.resolve(options.sourceEvent),
    recordFailure: () => {
      state.epoch += 1;
      return Promise.resolve(state.epoch);
    },
    recordTombstone: () => Promise.resolve({ id: "tombstone-1", observedAt: new Date(), priorAttempt: false }),
    requestDeleteConfirmation: (_source, _destination, reason) => {
      confirmations.push({ reason });
      return Promise.resolve();
    },
    resolveWriter: () => Promise.resolve(writer),
    withSourceLock: (_sourceCalendarId, run) => run(locked),
  };

  return { confirmations, quarantines, state, store, writerCalls };
};

const createUnwritableWriteBack = (): InboundClassification => ({
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

const createDelete = (): InboundClassification => ({
  expectedSource: { endTime: END_TIME, isAllDay: false, startTime: START_TIME },
  expectedSyncEventHash: PUSHED_HASH,
  mappingId: MAPPING_ID,
  sourceEventUid: SOURCE_EVENT_UID,
  type: "delete",
});

const UNTITLED_SOURCE_EVENT: SourceEventSnapshot = {
  description: null,
  endTime: END_TIME,
  isAllDay: null,
  location: null,
  startTime: START_TIME,
  startTimeZone: null,
  title: null,
};

describe("runWriteBackPass: inbound work that cannot complete is bounded", () => {
  it("matches an untitled source event against the placeholder title the copy carries", async () => {
    const harness = createNonProgressHarness({ sourceEvent: UNTITLED_SOURCE_EVENT });

    const result = await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications: [createUnwritableWriteBack()],
      store: harness.store,
    });

    expect(result).toEqual({
      abandoned: 0,
      applied: 1,
      failed: 0,
      heldForGrant: 0,
      quarantined: 0,
      withheld: 0,
    });
    expect(harness.writerCalls).toEqual(["update"]);
  });

  it("spends the budget on a write-back that keeps being abandoned", async () => {
    const harness = createNonProgressHarness({
      sourceEvent: { ...UNTITLED_SOURCE_EVENT, title: "Something else entirely" },
    });

    for (let pass = 0; pass < REPEATED_PASS_COUNT; pass += 1) {
      await runWriteBackPass({
        calendarId: DESTINATION_CALENDAR_ID,
        classifications: [createUnwritableWriteBack()],
        store: harness.store,
      });
    }

    expect(harness.writerCalls).toEqual([]);
    expect(harness.state.epoch).toBeGreaterThanOrEqual(TWO_WAY_EPOCH_QUARANTINE_LIMIT);
  });

  it("asks for a human answer once the probe has vetoed the same deletion enough times", async () => {
    const harness = createNonProgressHarness({
      presence: "present",
      sourceEvent: UNTITLED_SOURCE_EVENT,
    });

    for (let pass = 0; pass < REPEATED_PASS_COUNT; pass += 1) {
      await runWriteBackPass({
        calendarId: DESTINATION_CALENDAR_ID,
        classifications: [createDelete()],
        store: harness.store,
      });
    }

    expect(harness.writerCalls).toEqual([]);
    expect(harness.confirmations.map(({ reason }) => reason)).toContain(
      "delete_probe_blocked",
    );
  });
});
