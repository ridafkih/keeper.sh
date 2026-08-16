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
const NEXT_MAPPING_ID = "mapping-next";
const START_TIME = new Date("2027-05-11T14:00:00.000Z");
const END_TIME = new Date("2027-05-11T15:00:00.000Z");
const MOVED_START_TIME = new Date("2027-05-11T17:00:00.000Z");
const MOVED_END_TIME = new Date("2027-05-11T18:00:00.000Z");
const PUSHED_HASH = "the-hash-of-what-we-last-pushed";
const NOTHING = 0;
const ONCE = 1;

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

const ATTENDEE_REFUSAL = {
  error: "Keeper.sh does not write to a source event other people are invited to.",
  refused: "event_has_attendees",
  success: false,
} as const;

const createHarness = () => {
  const abandoned: string[] = [];
  const committedDeletes: string[] = [];
  const committedUpdates: string[] = [];
  const failures: string[] = [];
  const quarantines: { reason: string; sourceCalendarId: string }[] = [];
  const tombstones: string[] = [];

  const writer: CalendarSourceWriter = {
    deleteEvent: () => Promise.resolve(ATTENDEE_REFUSAL),
    updateEvent: () => Promise.resolve(ATTENDEE_REFUSAL),
  };

  const locked: LockedWriteBackStore = {
    commitDelete: ({ mappingId }) => {
      committedDeletes.push(mappingId);
      return Promise.resolve();
    },
    commitUpdate: ({ mappingId }) => {
      committedUpdates.push(mappingId);
      return Promise.resolve({ writeBackEpoch: 1 });
    },
    readMappingSyncEventHash: () => Promise.resolve({ syncEventHash: PUSHED_HASH }),
    readPairWriteBack: () =>
      Promise.resolve({ writeBackMode: "edits_and_deletes", writeBackState: "ok" }),
    readSourceEvent: () => Promise.resolve(createSourceEvent()),
  };

  const store: WriteBackStore = {
    abandonTombstone: ({ tombstoneId }) => {
      abandoned.push(tombstoneId);
      return Promise.resolve();
    },
    countRecentDeletes: () => Promise.resolve(NOTHING),
    loadTarget: (mappingId) => Promise.resolve(createTarget(mappingId)),
    notifySiblings: () => Promise.resolve(),
    probeDestinationEvent: () => Promise.resolve("absent"),
    quarantineMapping: (sourceCalendarId, _destinationCalendarId, reason) => {
      quarantines.push({ reason, sourceCalendarId });
      return Promise.resolve();
    },
    readSourceEvent: () => Promise.resolve(createSourceEvent()),
    recordFailure: (mappingId) => {
      failures.push(mappingId);
      return Promise.resolve(ONCE);
    },
    recordTombstone: () => {
      tombstones.push("tombstone-1");
      return Promise.resolve({ id: "tombstone-1", observedAt: new Date(), priorAttempt: false });
    },
    resolveWriter: () => Promise.resolve(writer),
    withSourceLock: (_sourceCalendarId, run) => run(locked),
  };

  return { abandoned, committedDeletes, committedUpdates, failures, quarantines, store };
};

describe("a write the source writer refuses pauses the pair instead of retrying it", () => {
  it("drops the local record of nothing when a delete is refused", async () => {
    const harness = createHarness();

    const result = await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications: [createDelete(MEETING_MAPPING_ID)],
      store: harness.store,
    });

    expect(harness.committedDeletes).toEqual([]);
    expect(harness.abandoned).toEqual(["tombstone-1"]);
    expect(harness.quarantines).toEqual([
      { reason: "source_event_has_attendees", sourceCalendarId: SOURCE_CALENDAR_ID },
    ]);
    expect(result.quarantined).toBe(ONCE);
    expect(result.failed).toBe(NOTHING);
  });

  it("commits no local update when an edit is refused", async () => {
    const harness = createHarness();

    const result = await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications: [createWriteBack(MEETING_MAPPING_ID)],
      store: harness.store,
    });

    expect(harness.quarantines).toEqual([
      { reason: "source_event_has_attendees", sourceCalendarId: SOURCE_CALENDAR_ID },
    ]);
    expect(result.quarantined).toBe(ONCE);
    expect(result.failed).toBe(NOTHING);
  });

  /*
   * A refusal is a decision about the pair, not about the one event: the pass has just
   * told the user it stopped writing to this source, so it must not keep writing to it.
   */
  it("fences the rest of the pass off from the same pair", async () => {
    const harness = createHarness();

    const result = await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications: [
        createDelete(MEETING_MAPPING_ID),
        createDelete(NEXT_MAPPING_ID),
      ],
      store: harness.store,
    });

    expect(harness.quarantines).toHaveLength(ONCE);
    expect(harness.committedDeletes).toEqual([]);
    expect(result.withheld).toBe(ONCE);
  });

  it("never spends the failure budget on a refusal", async () => {
    const harness = createHarness();

    await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications: [createDelete(MEETING_MAPPING_ID)],
      store: harness.store,
    });

    expect(harness.failures).toEqual([]);
  });
});
