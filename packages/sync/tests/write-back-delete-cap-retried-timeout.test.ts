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
 * The provider destroys the event and the answer never arrives: the client-side write
 * timeout aborts a DELETE the server has already processed. Nothing local commits, so the
 * mapping survives and the very same deletion is classified again on the next pass — at
 * which point the source event it names is genuinely gone.
 */
const createHarness = () => {
  const destroyedOnTheProvider = new Set<string>();
  const tombstones = new Map<string, { state: string }>();
  const quarantines: string[] = [];
  const epochs = new Map<string, number>();
  const state = { mode: "timing-out" as "healthy" | "rate-limited" | "timing-out" };

  const writer: CalendarSourceWriter = {
    deleteEvent: (reference) => {
      if (state.mode === "rate-limited") {
        return Promise.resolve({ error: "Rate Limit Exceeded", success: false });
      }
      if (destroyedOnTheProvider.has(reference.sourceEventUid)) {
        return Promise.resolve({ success: true });
      }
      destroyedOnTheProvider.add(reference.sourceEventUid);
      if (state.mode === "timing-out") {
        return Promise.reject(new Error("The operation was aborted due to timeout"));
      }
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
    /*
     * One live record per mapping, refreshed rather than duplicated — the real store's
     * upsert on the unique event_mapping_id index, which rewrites state back to pending.
     */
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

const runPasses = async (store: WriteBackStore, indices: number[]): Promise<void> => {
  for (let offset = NONE; offset < indices.length; offset += PER_PASS) {
    await runPass(store, indices.slice(offset, offset + PER_PASS));
  }
};

const range = (start: number, length: number): number[] =>
  Array.from({ length }, (_unused, index) => start + index);

describe("a source deletion whose answer was lost and then retried", () => {
  it("keeps counting the destroyed event against the day's budget", async () => {
    const harness = createHarness();

    await runPasses(harness.store, [NONE]);
    expect(harness.destroyedOnTheProvider.has("source-event-uid-0")).toBe(true);
    expect(harness.tombstones.get("tombstone-mapping-0")).toEqual({ state: "pending" });

    harness.state.mode = "rate-limited";
    await runPasses(harness.store, [NONE]);

    expect(harness.destroyedOnTheProvider.has("source-event-uid-0")).toBe(true);
    expect(
      [...harness.tombstones.values()].filter((row) => countsTowardDeleteCap(row.state)).length,
    ).toBe(ONE);
  });

  it("still bounds a day's real destruction at the cap", async () => {
    const harness = createHarness();
    const lost = range(NONE, PER_PASS);

    await runPasses(harness.store, lost);
    harness.state.mode = "rate-limited";
    await runPasses(harness.store, lost);

    harness.state.mode = "healthy";
    await runPasses(harness.store, range(PER_PASS, TWO_WAY_DELETE_DAILY_CAP));

    expect(harness.destroyedOnTheProvider.size).toBeLessThanOrEqual(TWO_WAY_DELETE_DAILY_CAP);
  });

  /*
   * The control the round-seven and round-eight behaviour rests on: a rejection that
   * follows no attempt of its own destroyed nothing, and must not spend a slot.
   */
  it("still releases a record whose only attempt the provider refused", async () => {
    const harness = createHarness();
    harness.state.mode = "rate-limited";

    await runPasses(harness.store, [NONE]);

    expect(harness.destroyedOnTheProvider.size).toBe(NONE);
    expect(
      [...harness.tombstones.values()].filter((row) => countsTowardDeleteCap(row.state)).length,
    ).toBe(NONE);
  });
});
