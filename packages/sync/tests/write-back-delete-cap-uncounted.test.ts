import { describe, expect, it } from "vitest";
import { TWO_WAY_DELETE_DAILY_CAP } from "@keeper.sh/constants";
import type { CalendarSourceWriter, InboundClassification } from "@keeper.sh/calendar";
import { countsTowardDeleteCap, isUnresolvedAttempt } from "../src/write-back";
import { runWriteBackPass } from "../src/write-back-pass";
import type {
  LockedWriteBackStore,
  SourceEventSnapshot,
  WriteBackStore,
  WriteBackTarget,
} from "../src/write-back-pass";

const SOURCE_CALENDAR_ID = "source-calendar-id";
const DESTINATION_CALENDAR_ID = "destination-calendar-id";
const PUSHED_HASH = "the-hash-of-what-we-last-pushed";
const START_TIME = new Date("2027-05-11T14:00:00.000Z");
const END_TIME = new Date("2027-05-11T15:00:00.000Z");

const SOURCE_EVENT: SourceEventSnapshot = {
  description: null,
  endTime: END_TIME,
  isAllDay: null,
  location: null,
  startTime: START_TIME,
  startTimeZone: null,
  title: "Quarterly review",
};

const createTarget = (index: number): WriteBackTarget => ({
  deleteIdentifier: `mirror-${index}`,
  destinationCalendarId: DESTINATION_CALENDAR_ID,
  destinationEventUid: `mirror-${index}`,
  eventStateId: `event-state-${index}`,
  mappingId: `mapping-${index}`,
  sourceCalendarId: SOURCE_CALENDAR_ID,
  sourceEventId: null,
  sourceEventUid: `source-event-uid-${index}`,
});

const createDelete = (index: number): InboundClassification => ({
  expectedSource: {
    description: "",
    endTime: END_TIME,
    isAllDay: false,
    location: "",
    startTime: START_TIME,
    summary: "Quarterly review",
  },
  expectedSyncEventHash: PUSHED_HASH,
  mappingId: `mapping-${index}`,
  sourceEventUid: `source-event-uid-${index}`,
  type: "delete",
});

/*
 * The provider removes the event and then answers too slowly: TWO_WAY_SOURCE_WRITE_TIMEOUT_MS
 * aborts the request client side, so Keeper sees a failure for a deletion that really
 * happened. The tombstones table is the only record of how many source events have been
 * destroyed today, and it is the table the daily cap counts.
 */
const createHarness = (options: { writeAnswerArrivesLate: boolean }) => {
  const destroyedOnTheProvider: string[] = [];
  const tombstones = new Map<string, { appliedAt: Date | null; state: string }>();
  const quarantines: string[] = [];
  const epochs = new Map<string, number>();

  const writer: CalendarSourceWriter = {
    deleteEvent: (reference) => {
      destroyedOnTheProvider.push(reference.sourceEventUid);
      if (options.writeAnswerArrivesLate) {
        return Promise.reject(new Error("The operation was aborted due to timeout"));
      }
      return Promise.resolve({ success: true });
    },
    updateEvent: () => Promise.resolve({ success: true }),
  };

  const locked: LockedWriteBackStore = {
    commitDelete: ({ tombstoneId }) => {
      tombstones.set(tombstoneId, { appliedAt: new Date(), state: "applied" });
      return Promise.resolve();
    },
    commitUpdate: () => Promise.resolve({ writeBackEpoch: 1 }),
    readMappingSyncEventHash: () => Promise.resolve({ syncEventHash: PUSHED_HASH }),
    readPairWriteBack: () =>
      Promise.resolve({ writeBackMode: "edits_and_deletes", writeBackState: "ok" }),
    readSourceEvent: () => Promise.resolve(SOURCE_EVENT),
  };

  const store: WriteBackStore = {
    abandonTombstone: ({ tombstoneId }) => {
      tombstones.set(tombstoneId, { appliedAt: null, state: "abandoned" });
      return Promise.resolve();
    },
    /*
     * The rows the real table would hold, filtered by the predicate the real query
     * carries. Only the translation of that predicate into a drizzle clause lives
     * outside this test.
     */
    countRecentDeletes: () =>
      Promise.resolve(
        [...tombstones.values()].filter((row) => countsTowardDeleteCap(row.state)).length,
      ),
    loadTarget: (mappingId) =>
      Promise.resolve(createTarget(Number(mappingId.replace("mapping-", "")))),
    notifySiblings: () => Promise.resolve(),
    probeDestinationEvent: () => Promise.resolve("absent"),
    quarantineMapping: (_source, _destination, reason) => {
      quarantines.push(reason);
      return Promise.resolve();
    },
    readSourceEvent: () => Promise.resolve(SOURCE_EVENT),
    recordFailure: (mappingId) => {
      const spent = (epochs.get(mappingId) ?? 0) + 1;
      epochs.set(mappingId, spent);
      return Promise.resolve(spent);
    },
    recordTombstone: ({ target }) => {
      const tombstoneId = `tombstone-${target.mappingId}`;
      const previous = tombstones.get(tombstoneId);
      const priorAttempt = isUnresolvedAttempt(previous);
      tombstones.set(tombstoneId, { appliedAt: null, state: "pending" });
      return Promise.resolve({ id: tombstoneId, observedAt: new Date(), priorAttempt });
    },
    requestDeleteConfirmation: () => Promise.resolve(),
    resolveWriter: () => Promise.resolve(writer),
    withSourceLock: (_sourceCalendarId, run) => run(locked),
  };

  return { destroyedOnTheProvider, quarantines, store };
};

/*
 * Every pass carries a fresh batch of mappings, which is what a destination whose copies
 * were wiped in bulk actually produces.
 */
const runPasses = async (
  store: WriteBackStore,
  passCount: number,
  perPass: number,
): Promise<void> => {
  let next = 0;
  for (let pass = 0; pass < passCount; pass += 1) {
    const classifications: InboundClassification[] = [];
    for (let index = 0; index < perPass; index += 1) {
      classifications.push(createDelete(next));
      next += 1;
    }
    await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications,
      store,
    });
  }
};

describe("the daily source-delete cap", () => {
  it("bounds the destruction when every provider answer arrives in time", async () => {
    const harness = createHarness({ writeAnswerArrivesLate: false });

    await runPasses(harness.store, 8, 25);

    expect(harness.destroyedOnTheProvider.length).toBeLessThanOrEqual(
      TWO_WAY_DELETE_DAILY_CAP,
    );
    /*
     * The bound is only worth asserting against a pass that really reaches the provider:
     * a classification the guards abandon destroys nothing and satisfies the cap for the
     * wrong reason.
     */
    expect(harness.destroyedOnTheProvider.length).toBeGreaterThan(0);
  });

  it("bounds the destruction when the provider answer arrives after the timeout", async () => {
    const harness = createHarness({ writeAnswerArrivesLate: true });

    await runPasses(harness.store, 8, 25);

    expect(harness.destroyedOnTheProvider.length).toBeLessThanOrEqual(
      TWO_WAY_DELETE_DAILY_CAP,
    );
    /*
     * The bound is only worth asserting against a pass that really reaches the provider:
     * a classification the guards abandon destroys nothing and satisfies the cap for the
     * wrong reason.
     */
    expect(harness.destroyedOnTheProvider.length).toBeGreaterThan(0);
  });
});
