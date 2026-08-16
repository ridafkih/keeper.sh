import { describe, expect, it } from "vitest";
import type { CalendarSourceWriter, InboundClassification } from "@keeper.sh/calendar";
import { runWriteBackPass } from "../src/write-back-pass";
import type {
  LockedWriteBackStore,
  PairWriteBackAuthority,
  SourceEventSnapshot,
  WriteBackStore,
  WriteBackTarget,
} from "../src/write-back-pass";

const SOURCE_CALENDAR_ID = "source-calendar-id";
const DESTINATION_CALENDAR_ID = "destination-calendar-id";
const START_TIME = new Date("2027-05-11T14:00:00.000Z");
const END_TIME = new Date("2027-05-11T15:00:00.000Z");
const PUSHED_HASH = "the-hash-of-what-we-last-pushed";

const createSourceSnapshot = (): SourceEventSnapshot => ({
  description: "Bring the notes",
  endTime: END_TIME,
  isAllDay: null,
  location: "Room 4",
  startTime: START_TIME,
  startTimeZone: null,
  title: "Quarterly review",
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

const createUpdate = (mappingId: string): InboundClassification => ({
  expectedSource: { summary: "Quarterly review" },
  expectedSyncEventHash: PUSHED_HASH,
  mappingId,
  observed: {
    availability: null,
    contentHash: "observed-hash",
    description: "Bring the notes",
    endTime: END_TIME,
    isAllDay: false,
    location: "Room 4",
    startTime: START_TIME,
    summary: "Quarterly review (moved to the cafe)",
  },
  projectedSyncEventHash: "projected-hash",
  sourceEventUid: `source-event-uid-${mappingId}`,
  type: "write-back",
  updates: { summary: "Quarterly review (moved to the cafe)" },
});

const createHarness = (pair: PairWriteBackAuthority) => {
  const destroyed: string[] = [];
  const snapshot = createSourceSnapshot();

  const writer: CalendarSourceWriter = {
    deleteEvent: (reference) => {
      destroyed.push(`${reference.sourceEventUid}-mapping`);
      return Promise.resolve({ success: true });
    },
    updateEvent: (reference) => {
      destroyed.push(`${reference.sourceEventUid}-mapping`);
      return Promise.resolve({ success: true });
    },
  };

  const locked: LockedWriteBackStore = {
    commitDelete: () => Promise.resolve(),
    commitUpdate: () => Promise.resolve({ writeBackEpoch: 1 }),
    readMappingSyncEventHash: () => Promise.resolve({ syncEventHash: PUSHED_HASH }),
    readPairWriteBack: () => Promise.resolve(pair),
    readSourceEvent: () => Promise.resolve(snapshot),
  };

  const createTarget = (mappingId: string): WriteBackTarget => ({
    destinationCalendarId: DESTINATION_CALENDAR_ID,
    eventStateId: `event-state-${mappingId}`,
    mappingId,
    sourceCalendarId: SOURCE_CALENDAR_ID,
    sourceEventId: null,
    sourceEventUid: `source-event-uid-${mappingId}`,
  });

  const store: WriteBackStore = {
    abandonTombstone: () => Promise.resolve(),
    countRecentDeletes: () => Promise.resolve(0),
    loadTarget: (mappingId) => Promise.resolve(createTarget(mappingId)),
    notifySiblings: () => Promise.resolve(),
    probeDestinationEvent: () => Promise.resolve("absent"),
    quarantineMapping: () => Promise.resolve(),
    readSourceEvent: () => Promise.resolve(snapshot),
    recordFailure: () => Promise.resolve(1),
    recordTombstone: () => Promise.resolve({ id: "tombstone-1", observedAt: new Date(), priorAttempt: false }),
    requestDeleteConfirmation: () => Promise.resolve(),
    resolveWriter: () => Promise.resolve(writer),
    withSourceLock: (_sourceCalendarId, run) => run(locked),
  };

  return { destroyed, store };
};

const run = (
  pair: PairWriteBackAuthority,
  classifications: InboundClassification[],
) => {
  const harness = createHarness(pair);
  return runWriteBackPass({
    calendarId: DESTINATION_CALENDAR_ID,
    classifications,
    store: harness.store,
  }).then((result) => ({ destroyed: harness.destroyed, result }));
};

describe("two-way sync: the user's off switch stops the pass already running", () => {
  it("does not delete the original once the pair reads write-back off", async () => {
    const { destroyed, result } = await run(
      { writeBackMode: "off", writeBackState: "ok" },
      [createDelete("doomed")],
    );

    expect(destroyed).toEqual([]);
    expect(result).toMatchObject({ applied: 0, withheld: 1 });
  });

  it("does not delete the original once the pair drops to edits only", async () => {
    const { destroyed, result } = await run(
      { writeBackMode: "edits", writeBackState: "ok" },
      [createDelete("doomed")],
    );

    expect(destroyed).toEqual([]);
    expect(result).toMatchObject({ applied: 0, withheld: 1 });
  });

  it("does not rewrite the original once the pair reads write-back off", async () => {
    const { destroyed, result } = await run(
      { writeBackMode: "off", writeBackState: "ok" },
      [createUpdate("doomed")],
    );

    expect(destroyed).toEqual([]);
    expect(result).toMatchObject({ applied: 0, withheld: 1 });
  });

  it("does not write to a pair a human has been asked about", async () => {
    const { destroyed } = await run(
      { writeBackMode: "edits_and_deletes", writeBackState: "delete_confirmation_required" },
      [createDelete("doomed")],
    );

    expect(destroyed).toEqual([]);
  });

  it("does not write to a pair whose row has gone", async () => {
    const harness = createHarness({ writeBackMode: "off", writeBackState: "ok" });
    const store: WriteBackStore = {
      ...harness.store,
      withSourceLock: (_sourceCalendarId, callback) =>
        callback({
          commitDelete: () => Promise.resolve(),
          commitUpdate: () => Promise.resolve({ writeBackEpoch: 1 }),
          readMappingSyncEventHash: () => Promise.resolve({ syncEventHash: PUSHED_HASH }),
          readPairWriteBack: () => Promise.resolve(null),
          readSourceEvent: () => Promise.resolve(createSourceSnapshot()),
        }),
    };

    await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications: [createDelete("doomed")],
      store,
    });

    expect(harness.destroyed).toEqual([]);
  });

  it("leaves the rest of the pair's classifications alone rather than retrying each", async () => {
    const { destroyed, result } = await run(
      { writeBackMode: "off", writeBackState: "ok" },
      [createDelete("first"), createDelete("second"), createUpdate("third")],
    );

    expect(destroyed).toEqual([]);
    expect(result).toMatchObject({ abandoned: 0, applied: 0, failed: 0, withheld: 3 });
  });

  it("still writes back for a pair that still authorizes it", async () => {
    const { destroyed, result } = await run(
      { writeBackMode: "edits_and_deletes", writeBackState: "ok" },
      [createDelete("live")],
    );

    expect(destroyed).toEqual(["source-event-uid-live-mapping"]);
    expect(result).toMatchObject({ applied: 1 });
  });
});
