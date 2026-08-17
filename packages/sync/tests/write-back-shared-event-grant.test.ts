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
const MEETING_MAPPING_ID = "mapping-meeting";
const SOLO_MAPPING_ID = "mapping-solo";
const START_TIME = new Date("2027-05-11T14:00:00.000Z");
const END_TIME = new Date("2027-05-11T15:00:00.000Z");
const MOVED_START_TIME = new Date("2027-05-11T17:00:00.000Z");
const MOVED_END_TIME = new Date("2027-05-11T18:00:00.000Z");
const PUSHED_HASH = "the-hash-of-what-we-last-pushed";
const NOTHING = 0;
const ONCE = 1;

const ATTENDEE_REFUSAL = {
  error: "Keeper.sh does not write to a source event other people are invited to.",
  refused: "event_has_attendees",
  success: false,
} as const;

const ACCEPTED = { success: true } as const;

const createSourceEvent = (): SourceEventSnapshot => ({
  description: "Bring the notes",
  endTime: END_TIME,
  isAllDay: null,
  location: "Room 4",
  startTime: START_TIME,
  startTimeZone: null,
  title: "Quarterly review",
});

const createTarget = (mappingId: string): WriteBackTarget => ({
  destinationCalendarId: DESTINATION_CALENDAR_ID,
  eventStateId: `event-state-${mappingId}`,
  mappingId,
  sourceCalendarId: SOURCE_CALENDAR_ID,
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

/*
 * Only the meeting is refused. The solo event that follows it in the same pass is the whole
 * question: a permission the user has not given yet says nothing about whether the rest of
 * the pair is safe to write, so it must still land.
 */
const createHarness = () => {
  const committedUpdates: string[] = [];
  const attempted: string[] = [];
  const quarantines: { reason: string; sourceCalendarId: string }[] = [];

  const writer: CalendarSourceWriter = {
    deleteEvent: () => Promise.resolve(ACCEPTED),
    updateEvent: (reference) => {
      attempted.push(reference.sourceEventUid);
      if (reference.sourceEventUid === `source-event-uid-${MEETING_MAPPING_ID}`) {
        return Promise.resolve(ATTENDEE_REFUSAL);
      }
      return Promise.resolve(ACCEPTED);
    },
  };

  /*
   * The real lock is a transaction and the local commit is taken inside it, before the
   * provider is called, so a refusal rolls the commit back. A fake that kept it would
   * report a write that never persisted.
   */
  const staged: string[] = [];

  const locked: LockedWriteBackStore = {
    commitDelete: () => Promise.resolve(),
    commitUpdate: ({ mappingId }) => {
      staged.push(mappingId);
      return Promise.resolve({ writeBackAppliedCount: 1 });
    },
    readMappingSyncEventHash: () => Promise.resolve({ syncEventHash: PUSHED_HASH }),
    readPairWriteBack: () =>
      Promise.resolve({ writeBackMode: "edits_and_deletes", writeBackState: "ok" }),
    readSourceEvent: () => Promise.resolve(createSourceEvent()),
  };

  const store: WriteBackStore = {
    abandonTombstone: () => Promise.resolve(),
    countRecentDeletes: () => Promise.resolve(NOTHING),
    loadTarget: (mappingId) => Promise.resolve(createTarget(mappingId)),
    notifySiblings: () => Promise.resolve(),
    probeDestinationEvent: () => Promise.resolve("absent"),
    quarantineMapping: (sourceCalendarId, _destinationCalendarId, reason) => {
      quarantines.push({ reason, sourceCalendarId });
      return Promise.resolve();
    },
    readSourceEvent: () => Promise.resolve(createSourceEvent()),
    recordFailure: () => Promise.resolve(ONCE),
    recordTombstone: () =>
      Promise.resolve({ id: "tombstone-1", observedAt: new Date(), priorAttempt: false }),
    resolveWriter: () => Promise.resolve(writer),
    withSourceLock: async (_sourceCalendarId, run) => {
      staged.length = 0;
      try {
        const returned = await run(locked);
        committedUpdates.push(...staged);
        return returned;
      } finally {
        staged.length = 0;
      }
    },
  };

  return { attempted, committedUpdates, quarantines, store };
};

describe("an edit to a meeting the user has not granted", () => {
  it("holds that event without fencing the rest of the pair", async () => {
    const harness = createHarness();

    const result = await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications: [createWriteBack(MEETING_MAPPING_ID), createWriteBack(SOLO_MAPPING_ID)],
      store: harness.store,
    });

    expect(harness.attempted).toContain(`source-event-uid-${SOLO_MAPPING_ID}`);
    expect(harness.committedUpdates).toEqual([SOLO_MAPPING_ID]);
    expect(result.withheld).toBe(NOTHING);
  });

  it("does not quarantine the pair over a permission the user can give", async () => {
    const harness = createHarness();

    await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications: [createWriteBack(MEETING_MAPPING_ID)],
      store: harness.store,
    });

    expect(harness.quarantines).toEqual([]);
  });
});
