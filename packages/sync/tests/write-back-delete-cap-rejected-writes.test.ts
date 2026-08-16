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
const PER_PASS = 25;
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
    summary: "Busy",
  },
  expectedSyncEventHash: PUSHED_HASH,
  mappingId: `mapping-${index}`,
  sourceEventUid: `source-event-uid-${index}`,
  type: "delete",
});

/*
 * The provider is reachable and answers every request; it just says no — a 429, a 403, a
 * 5xx. Nothing on the source is destroyed by any of them.
 */
const createHarness = () => {
  const destroyedOnTheProvider: string[] = [];
  const tombstones = new Map<string, { state: string }>();
  const quarantines: string[] = [];
  const epochs = new Map<string, number>();
  const state = { rejecting: true };

  const writer: CalendarSourceWriter = {
    deleteEvent: (reference) => {
      if (state.rejecting) {
        return Promise.resolve({ error: "Rate Limit Exceeded", success: false });
      }
      destroyedOnTheProvider.push(reference.sourceEventUid);
      return Promise.resolve({ success: true });
    },
    updateEvent: () => Promise.resolve({ success: true }),
  };

  const locked: LockedWriteBackStore = {
    commitDelete: ({ tombstoneId }) => {
      tombstones.set(tombstoneId, { state: "applied" });
      return Promise.resolve();
    },
    commitUpdate: () => Promise.resolve({ writeBackEpoch: ONE }),
    readMappingSyncEventHash: () => Promise.resolve({ syncEventHash: PUSHED_HASH }),
    readPairWriteBack: () =>
      Promise.resolve({ writeBackMode: "edits_and_deletes", writeBackState: "ok" }),
    readSourceEvent: () => Promise.resolve(SOURCE_EVENT),
  };

  const store: WriteBackStore = {
    abandonTombstone: ({ tombstoneId }) => {
      tombstones.set(tombstoneId, { state: "abandoned" });
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
      const spent = (epochs.get(mappingId) ?? NONE) + ONE;
      epochs.set(mappingId, spent);
      return Promise.resolve(spent);
    },
    recordTombstone: ({ target }) => {
      const tombstoneId = `tombstone-${target.mappingId}`;
      const previous = tombstones.get(tombstoneId);
      const priorAttempt = isUnresolvedAttempt(previous);
      tombstones.set(tombstoneId, { state: "pending" });
      return Promise.resolve({ id: tombstoneId, observedAt: new Date(), priorAttempt });
    },
    requestDeleteConfirmation: () => Promise.resolve(),
    resolveWriter: () => Promise.resolve(writer),
    withSourceLock: (_sourceCalendarId, run) => run(locked),
  };

  return { destroyedOnTheProvider, quarantines, state, store, tombstones };
};

const runPass = (store: WriteBackStore, indices: number[]): Promise<unknown> =>
  runWriteBackPass({
    calendarId: DESTINATION_CALENDAR_ID,
    classifications: indices.map((index) => createDelete(index)),
    store,
  });

describe("a source provider that answers every delete with a refusal", () => {
  it("does not spend the day's source-deletion budget on deletions that never happened", async () => {
    const harness = createHarness();
    const rejected = Array.from({ length: TWO_WAY_DELETE_DAILY_CAP }, (_unused, index) => index);

    for (let offset = NONE; offset < rejected.length; offset += PER_PASS) {
      await runPass(harness.store, rejected.slice(offset, offset + PER_PASS));
    }

    expect(harness.destroyedOnTheProvider).toEqual([]);
    expect(harness.quarantines).not.toContain("delete_daily_cap");

    harness.state.rejecting = false;
    await runPass(harness.store, [TWO_WAY_DELETE_DAILY_CAP]);

    expect(harness.quarantines).not.toContain("delete_daily_cap");
    expect(harness.destroyedOnTheProvider).toEqual([
      `source-event-uid-${TWO_WAY_DELETE_DAILY_CAP}`,
    ]);
  });

  it("still bounds real destruction at the cap once the provider starts accepting", async () => {
    const harness = createHarness();
    harness.state.rejecting = false;
    const indices = Array.from(
      { length: TWO_WAY_DELETE_DAILY_CAP * 2 },
      (_unused, index) => index,
    );

    for (let offset = NONE; offset < indices.length; offset += PER_PASS) {
      await runPass(harness.store, indices.slice(offset, offset + PER_PASS));
    }

    expect(harness.destroyedOnTheProvider.length).toBeLessThanOrEqual(
      TWO_WAY_DELETE_DAILY_CAP,
    );
    expect(harness.quarantines).toContain("delete_daily_cap");
  });
});
