import { describe, expect, it } from "vitest";
import { TWO_WAY_EPOCH_QUARANTINE_LIMIT } from "@keeper.sh/calendar";
import type { CalendarSourceWriter, InboundClassification } from "@keeper.sh/calendar";
import {
  TWO_WAY_WRITE_BACK_DAILY_CAP,
  TWO_WAY_WRITE_BACK_DAILY_WINDOW_MS,
} from "@keeper.sh/constants";
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
const DAY_START = new Date("2027-05-01T00:00:00.000Z");
const HOUR_MS = 3_600_000;
const OSCILLATIONS_PER_HOUR = 4;
const HOURS_IN_A_DAY = 24;

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

const createHarness = () => {
  const quarantines: { reason: string }[] = [];
  const writerCalls: Date[] = [];
  const epochWindow = { count: 0, start: DAY_START };
  const dailyWindow = { count: 0, start: DAY_START };
  let clock = DAY_START;

  const writer: CalendarSourceWriter = {
    deleteEvent: () => Promise.resolve({ success: true }),
    updateEvent: () => {
      writerCalls.push(clock);
      return Promise.resolve({ success: true });
    },
  };

  const locked: LockedWriteBackStore = {
    commitDelete: () => Promise.resolve(),
    commitUpdate: () => {
      if (clock.getTime() - epochWindow.start.getTime() >= HOUR_MS) {
        epochWindow.count = 0;
        epochWindow.start = clock;
      }
      if (
        clock.getTime() - dailyWindow.start.getTime() >= TWO_WAY_WRITE_BACK_DAILY_WINDOW_MS
      ) {
        dailyWindow.count = 0;
        dailyWindow.start = clock;
      }
      epochWindow.count += 1;
      dailyWindow.count += 1;
      return Promise.resolve({
        writeBackDailyCount: dailyWindow.count,
        writeBackEpoch: epochWindow.count,
      });
    },
    readMappingSyncEventHash: () => Promise.resolve({ syncEventHash: PUSHED_HASH }),
    readPairWriteBack: () =>
      Promise.resolve({ writeBackMode: "edits_and_deletes", writeBackState: "ok" }),
    readSourceEvent: () => Promise.resolve(createSourceEvent()),
  };

  const store: WriteBackStore = {
    abandonTombstone: () => Promise.resolve(),
    countRecentDeletes: () => Promise.resolve(0),
    loadTarget: () => Promise.resolve(createTarget()),
    notifySiblings: () => Promise.resolve(),
    quarantineMapping: (_sourceCalendarId, _destinationCalendarId, reason) => {
      quarantines.push({ reason });
      return Promise.resolve();
    },
    readSourceEvent: () => Promise.resolve(createSourceEvent()),
    recordFailure: () => Promise.resolve(0),
    recordTombstone: () => Promise.resolve({ id: "tombstone-1", observedAt: new Date(), priorAttempt: false }),
    resolveWriter: () => Promise.resolve(writer),
    withSourceLock: (_sourceCalendarId, run) => run(locked),
  };

  const runAt = (at: Date) => {
    clock = at;
    return runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications: [createWriteBack()],
      now: () => clock,
      store,
    });
  };

  return { epochWindow, quarantines, runAt, writerCalls };
};

describe("two-way sync: a slow oscillation cannot renew its budget forever", () => {
  it("quarantines a destination that stays under the hourly budget all day", async () => {
    const harness = createHarness();

    for (let hour = 0; hour < HOURS_IN_A_DAY; hour += 1) {
      for (let index = 0; index < OSCILLATIONS_PER_HOUR; index += 1) {
        await harness.runAt(new Date(
          DAY_START.getTime() + (hour * HOUR_MS) + (index * (HOUR_MS / OSCILLATIONS_PER_HOUR)),
        ));
      }
    }

    expect(harness.quarantines.map(({ reason }) => reason)).toContain("runaway_write_back");
  });

  it("never lets the hourly budget alone trip on a four-per-hour oscillation", async () => {
    const harness = createHarness();

    for (let index = 0; index < OSCILLATIONS_PER_HOUR; index += 1) {
      await harness.runAt(new Date(
        DAY_START.getTime() + (index * (HOUR_MS / OSCILLATIONS_PER_HOUR)),
      ));
    }

    expect(harness.epochWindow.count).toBeLessThan(TWO_WAY_EPOCH_QUARANTINE_LIMIT);
    expect(harness.quarantines).toEqual([]);
  });

  it("stops writing to the real calendar once the daily cap is spent", async () => {
    const harness = createHarness();
    const attempts = TWO_WAY_WRITE_BACK_DAILY_CAP * 2;

    for (let index = 0; index < attempts; index += 1) {
      await harness.runAt(new Date(
        DAY_START.getTime() + (index * (HOUR_MS / OSCILLATIONS_PER_HOUR)),
      ));
    }

    expect(harness.writerCalls.length).toBeLessThanOrEqual(TWO_WAY_WRITE_BACK_DAILY_CAP);
  });

  it("leaves a mapping well inside the daily cap alone", async () => {
    const harness = createHarness();

    for (let index = 0; index < OSCILLATIONS_PER_HOUR; index += 1) {
      await harness.runAt(new Date(DAY_START.getTime() + (index * HOUR_MS * 2)));
    }

    expect(harness.quarantines).toEqual([]);
    expect(harness.writerCalls.length).toBe(OSCILLATIONS_PER_HOUR);
  });
});
