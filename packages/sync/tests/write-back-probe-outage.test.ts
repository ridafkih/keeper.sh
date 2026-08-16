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
const PUSHED_HASH = "the-hash-of-what-we-last-pushed";
const START_TIME = new Date("2027-05-11T14:00:00.000Z");
const END_TIME = new Date("2027-05-11T15:00:00.000Z");
const NONE = 0;
const ONE = 1;

const SOURCE_EVENT: SourceEventSnapshot = {
  description: "",
  endTime: END_TIME,
  isAllDay: false,
  location: "",
  startTime: START_TIME,
  startTimeZone: null,
  title: "Dentist",
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

const createDelete = (mappingId: string = MAPPING_ID): InboundClassification => ({
  expectedSource: {
    description: "",
    endTime: END_TIME,
    isAllDay: false,
    location: "",
    startTime: START_TIME,
    summary: "Dentist",
  },
  expectedSyncEventHash: PUSHED_HASH,
  mappingId,
  sourceEventUid: SOURCE_EVENT_UID,
  type: "delete",
} as unknown as InboundClassification);

/*
 * The destination probe is the one read that stands between a listing that came back short
 * and a real source event being destroyed, so every provider was deliberately taught to
 * throw rather than answer "absent" when it cannot see the account's calendars. This drives
 * that throw through the pass and reads what it costs the user.
 */
const createHarness = (probe: () => Promise<"absent" | "present">) => {
  const deleted: string[] = [];
  const quarantines: string[] = [];
  const confirmations: string[] = [];
  const epoch = { spent: NONE };
  const pair = { writeBackState: "ok" };

  const writer = {
    deleteEvent: (reference: { sourceEventUid: string }) => {
      deleted.push(reference.sourceEventUid);
      return Promise.resolve({ success: true });
    },
    updateEvent: () => Promise.resolve({ success: true }),
  } as unknown as CalendarSourceWriter;

  const locked: LockedWriteBackStore = {
    commitDelete: () => Promise.resolve(),
    commitUpdate: () => Promise.resolve({ writeBackDailyCount: ONE, writeBackEpoch: ONE }),
    readMappingSyncEventHash: () => Promise.resolve({ syncEventHash: PUSHED_HASH }),
    readPairWriteBack: () =>
      Promise.resolve({
        writeBackMode: "edits_and_deletes",
        writeBackState: pair.writeBackState,
      }),
    readSourceEvent: () => Promise.resolve(SOURCE_EVENT),
  };

  const store: WriteBackStore = {
    abandonTombstone: () => Promise.resolve(),
    countRecentDeletes: () => Promise.resolve(NONE),
    loadTarget: (mappingId) => Promise.resolve({ ...createTarget(), mappingId }),
    notifySiblings: () => Promise.resolve(),
    probeDestinationEvent: probe,
    quarantineMapping: (_source, _destination, reason) => {
      quarantines.push(reason);
      pair.writeBackState = "quarantined";
      return Promise.resolve();
    },
    readSourceEvent: () => Promise.resolve(SOURCE_EVENT),
    recordFailure: () => {
      epoch.spent += ONE;
      return Promise.resolve(epoch.spent);
    },
    recordTombstone: () =>
      Promise.resolve({ id: "tombstone-1", observedAt: new Date(), priorAttempt: false }),
    requestDeleteConfirmation: (_source, _destination, reason) => {
      confirmations.push(reason);
      pair.writeBackState = "delete_confirmation_required";
      return Promise.resolve();
    },
    resolveWriter: () => Promise.resolve(writer),
    withSourceLock: (_sourceCalendarId, run) => run(locked),
  };

  return { confirmations, deleted, quarantines, store };
};

const runPass = (
  store: WriteBackStore,
  classifications: InboundClassification[] = [createDelete()],
): Promise<unknown> =>
  runWriteBackPass({
    calendarId: DESTINATION_CALENDAR_ID,
    classifications,
    onError: () => {
      /* The probe failure is the fixture; the assertions read the pair's state. */
    },
    store,
  });

describe("a destination that cannot answer the probe has not said the copy is gone", () => {
  it("pauses and asks a human when the probe answers that the copy is still there", async () => {
    const harness = createHarness(() => Promise.resolve("present"));

    for (let pass = NONE; pass < TWO_WAY_EPOCH_QUARANTINE_LIMIT; pass += ONE) {
      await runPass(harness.store);
    }

    expect(harness.deleted).toEqual([]);
    expect(harness.confirmations).toEqual(["delete_probe_blocked"]);
    expect(harness.quarantines).toEqual([]);
  });

  /*
   * A calendar-list read that returns 429 or 503 is the provider saying "not right now",
   * exactly like a throttled source write. A throttled source write is retried on a budget
   * of thirty; this is spent as a permanent failure at five, which turns two-way sync off
   * for the whole pair, clears every recorded observation and hands the edited copies back
   * to the one-way repair that rebuilds them from the original.
   */
  it("does not turn two-way sync off because the destination could not be read for five minutes", async () => {
    const harness = createHarness(() =>
      Promise.reject(new Error("Google calendarList responded 429")));

    for (let pass = NONE; pass < TWO_WAY_EPOCH_QUARANTINE_LIMIT; pass += ONE) {
      await runPass(harness.store);
    }

    expect(harness.deleted).toEqual([]);
    expect(harness.quarantines).toEqual([]);
    expect(harness.confirmations).toEqual(["delete_probe_blocked"]);
  });

  /*
   * The probe sweeps every calendar the account can read, one list call per candidate per
   * calendar, so a pass holding several vanished copies issues dozens of reads in a burst
   * and a throttle arrives for all of them at once. The budget is spent per classification
   * rather than per pass, so five candidates are enough to turn the connection off inside a
   * single pass — before any of them has been retried even once.
   */
  it("does not turn two-way sync off inside one pass because five candidates hit the same outage", async () => {
    const harness = createHarness(() =>
      Promise.reject(new Error("Google calendarList responded 429")));
    const candidates = [ONE, 2, 3, 4, 5].map((index) => createDelete(`mapping-id-${index}`));

    await runPass(harness.store, candidates);

    expect(harness.deleted).toEqual([]);
    expect(harness.quarantines).toEqual([]);
    expect(harness.confirmations).toEqual(["delete_probe_blocked"]);
  });
});
