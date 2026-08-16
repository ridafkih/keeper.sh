import { describe, expect, it } from "vitest";
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
const EVENT_STATE_ID = "event-state-id-1";
const MAPPING_ID = "mapping-id-1";
const SOURCE_EVENT_UID = "source-event-uid-1";
const START_TIME = new Date("2027-05-11T14:00:00.000Z");
const END_TIME = new Date("2027-05-11T15:00:00.000Z");
const PUSHED_HASH = "the-hash-of-what-we-last-pushed";

const createSourceSnapshot = (
  overrides: Partial<SourceEventSnapshot> = {},
): SourceEventSnapshot => ({
  description: "Bring the notes",
  endTime: END_TIME,
  isAllDay: null,
  location: "Room 4",
  startTime: START_TIME,
  startTimeZone: null,
  title: "Quarterly review",
  ...overrides,
});

/*
 * The schedule-only expected source is what a deletion classified before this guard existed
 * carries, and what a pass in flight during a deploy still hands over. It is not evidence
 * that the source event is untouched, so it cannot authorize destroying one.
 */
const createScheduleOnlyDelete = (): InboundClassification => ({
  expectedSource: { endTime: END_TIME, isAllDay: false, startTime: START_TIME },
  expectedSyncEventHash: PUSHED_HASH,
  mappingId: MAPPING_ID,
  sourceEventUid: SOURCE_EVENT_UID,
  type: "delete",
});

const createFullDelete = (): InboundClassification => ({
  expectedSource: {
    description: "Bring the notes",
    endTime: END_TIME,
    isAllDay: false,
    location: "Room 4",
    startTime: START_TIME,
    summary: "Quarterly review",
  },
  expectedSyncEventHash: PUSHED_HASH,
  mappingId: MAPPING_ID,
  sourceEventUid: SOURCE_EVENT_UID,
  type: "delete",
});

const createHarness = (snapshot: SourceEventSnapshot) => {
  const log: string[] = [];

  const writer: CalendarSourceWriter = {
    deleteEvent: () => {
      log.push("provider:delete");
      return Promise.resolve({ success: true });
    },
    updateEvent: () => Promise.resolve({ success: true }),
  };

  const locked: LockedWriteBackStore = {
    commitDelete: () => {
      log.push("commit:delete");
      return Promise.resolve();
    },
    commitUpdate: () => Promise.resolve({ writeBackEpoch: 1 }),
    readMappingSyncEventHash: () => Promise.resolve({ syncEventHash: PUSHED_HASH }),
    readPairWriteBack: () =>
      Promise.resolve({ writeBackMode: "edits_and_deletes", writeBackState: "ok" }),
    readSourceEvent: () => Promise.resolve(snapshot),
  };

  const target: WriteBackTarget = {
    destinationCalendarId: DESTINATION_CALENDAR_ID,
    eventStateId: EVENT_STATE_ID,
    mappingId: MAPPING_ID,
    sourceCalendarId: SOURCE_CALENDAR_ID,
    sourceEventId: null,
    sourceEventUid: SOURCE_EVENT_UID,
  };

  const store: WriteBackStore = {
    abandonTombstone: () => Promise.resolve(),
    countRecentDeletes: () => Promise.resolve(0),
    loadTarget: () => Promise.resolve(target),
    notifySiblings: () => Promise.resolve(),
    probeDestinationEvent: () => Promise.resolve("absent"),
    quarantineMapping: () => Promise.resolve(),
    readSourceEvent: () => Promise.resolve(snapshot),
    recordFailure: () => Promise.resolve(0),
    recordTombstone: () => Promise.resolve({ id: "tombstone-1", observedAt: new Date(), priorAttempt: false }),
    resolveWriter: () => Promise.resolve(writer),
    withSourceLock: (_sourceCalendarId, run) => run(locked),
  };

  return { log, store };
};

const runDelete = (
  classification: InboundClassification,
  snapshot: SourceEventSnapshot,
) => {
  const harness = createHarness(snapshot);
  return runWriteBackPass({
    calendarId: DESTINATION_CALENDAR_ID,
    classifications: [classification],
    store: harness.store,
  }).then((result) => ({ log: harness.log, result }));
};

describe("two-way sync: a source event edited under the lock is not deleted", () => {
  it("abandons the deletion when the title moved after it was classified", async () => {
    const { log, result } = await runDelete(
      createFullDelete(),
      createSourceSnapshot({ title: "Quarterly review (KEEP)" }),
    );

    expect(log).toEqual([]);
    expect(result).toMatchObject({ applied: 0 });
  });

  it("abandons the deletion when the evidence covers only the schedule", async () => {
    const { log, result } = await runDelete(
      createScheduleOnlyDelete(),
      createSourceSnapshot({ title: "Quarterly review (KEEP)" }),
    );

    expect(log).toEqual([]);
    expect(result).toMatchObject({ applied: 0 });
  });

  it("abandons the deletion when the description moved after it was classified", async () => {
    const { log } = await runDelete(
      createFullDelete(),
      createSourceSnapshot({ description: "Do not delete, rescheduling in progress" }),
    );

    expect(log).toEqual([]);
  });

  it("abandons the deletion when the location moved after it was classified", async () => {
    const { log } = await runDelete(
      createFullDelete(),
      createSourceSnapshot({ location: "Room 9" }),
    );

    expect(log).toEqual([]);
  });

  it("still deletes a source event nobody touched", async () => {
    const { log } = await runDelete(createFullDelete(), createSourceSnapshot());

    expect(log).toEqual(["provider:delete", "commit:delete"]);
  });
});
