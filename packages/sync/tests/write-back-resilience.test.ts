import { describe, expect, it } from "vitest";
import { TWO_WAY_EPOCH_QUARANTINE_LIMIT } from "@keeper.sh/calendar";
import type { CalendarSourceWriter, InboundClassification } from "@keeper.sh/calendar";
import { runWriteBackPass } from "../src/write-back-pass";
import { isUnresolvedAttempt } from "../src/write-back";
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

const createSourceEvent = (): SourceEventSnapshot => ({
  description: "Bring the notes",
  endTime: END_TIME,
  isAllDay: null,
  location: "Room 4",
  startTime: START_TIME,
  startTimeZone: "America/Toronto",
  title: "Quarterly review",
});

const createTarget = (): WriteBackTarget => ({
  deleteIdentifier: "destination-delete-id-1",
  destinationCalendarId: DESTINATION_CALENDAR_ID,
  destinationEventUid: "destination-uid-1",
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
    summary: "Renamed on the destination",
  },
  projectedSyncEventHash: "projected-hash",
  sourceEventUid: SOURCE_EVENT_UID,
  type: "write-back",
  updates: { summary: "Renamed on the destination" },
});

interface ResilienceOptions {
  resolveWriter?: () => Promise<CalendarSourceWriter | null>;
  target?: WriteBackTarget | null;
}

const resolveTarget = (options: ResilienceOptions): WriteBackTarget | null => {
  if ("target" in options) {
    return options.target ?? null;
  }
  return createTarget();
};

const createHarness = (options: ResilienceOptions = {}) => {
  const log: string[] = [];
  const tombstonesByMapping = new Map<string, { id: string; state: string }>();
  const quarantines: string[] = [];
  const failures: string[] = [];
  let sourceEvent: SourceEventSnapshot | null = createSourceEvent();
  let epoch = 0;
  let tombstoneCounter = 0;

  const writer: CalendarSourceWriter = {
    deleteEvent: () => {
      log.push("provider:delete");
      return Promise.resolve({ success: true });
    },
    updateEvent: () => {
      log.push("provider:update");
      return Promise.resolve({ success: true });
    },
  };

  const locked: LockedWriteBackStore = {
    commitDelete: ({ tombstoneId }) => {
      log.push("commit:delete");
      sourceEvent = null;
      for (const [mappingId, tombstone] of tombstonesByMapping) {
        if (tombstone.id === tombstoneId) {
          tombstonesByMapping.set(mappingId, { ...tombstone, state: "applied" });
        }
      }
      return Promise.resolve();
    },
    commitUpdate: () => {
      log.push("commit:update");
      epoch += 1;
      return Promise.resolve({ writeBackEpoch: epoch });
    },
    readMappingSyncEventHash: () => Promise.resolve({ syncEventHash: PUSHED_HASH }),
    readPairWriteBack: () =>
      Promise.resolve({ writeBackMode: "edits_and_deletes", writeBackState: "ok" }),
    readSourceEvent: () => Promise.resolve(sourceEvent),
  };

  const store: WriteBackStore = {
    abandonTombstone: ({ tombstoneId }) => {
      for (const [mappingId, tombstone] of tombstonesByMapping) {
        if (tombstone.id === tombstoneId) {
          tombstonesByMapping.set(mappingId, { ...tombstone, state: "abandoned" });
        }
      }
      return Promise.resolve();
    },
    countRecentDeletes: () => Promise.resolve(0),
    loadTarget: () =>
      Promise.resolve(resolveTarget(options)),
    probeDestinationEvent: () => Promise.resolve("absent"),
    notifySiblings: () => Promise.resolve(),
    quarantineMapping: (_sourceCalendarId, _destinationCalendarId, reason) => {
      quarantines.push(reason);
      return Promise.resolve();
    },
    readSourceEvent: () => Promise.resolve(sourceEvent),
    recordFailure: (mappingId) => {
      failures.push(mappingId);
      epoch += 1;
      return Promise.resolve(epoch);
    },
    recordTombstone: ({ target }) => {
      log.push("tombstone:commit");
      tombstoneCounter += 1;
      const id = `tombstone-${tombstoneCounter}`;
      const previous = tombstonesByMapping.get(target.mappingId);
      const priorAttempt = isUnresolvedAttempt(previous);
      tombstonesByMapping.set(target.mappingId, { id, state: "pending" });
      return Promise.resolve({ id, observedAt: new Date(), priorAttempt });
    },
    resolveWriter: options.resolveWriter ?? (() => Promise.resolve(writer)),
    withSourceLock: (_sourceCalendarId, run) => run(locked),
  };

  return {
    failures,
    log,
    quarantines,
    readSourceEvent: () => sourceEvent,
    store,
    tombstonesByMapping,
  };
};

describe("two-way sync: an unusable source is reported, never silently skipped", () => {
  it("counts an unresolvable writer as a failure and quarantines the pair", async () => {
    const harness = createHarness({ resolveWriter: () => Promise.resolve(null) });
    const errors: string[] = [];

    for (let pass = 0; pass < TWO_WAY_EPOCH_QUARANTINE_LIMIT; pass += 1) {
      const result = await runWriteBackPass({
        calendarId: DESTINATION_CALENDAR_ID,
        classifications: [createWriteBack()],
        onError: (error) => {
          errors.push(String(error));
        },
        store: harness.store,
      });
      expect(result.failed).toBe(1);
      expect(result.applied).toBe(0);
    }

    expect(harness.failures.length).toBe(TWO_WAY_EPOCH_QUARANTINE_LIMIT);
    expect(harness.quarantines).toContain("write_back_failing");
    expect(errors.length).toBe(TWO_WAY_EPOCH_QUARANTINE_LIMIT);
  });

  it("counts an unloadable mapping as a failure rather than doing nothing", async () => {
    const harness = createHarness({ target: null });
    const errors: string[] = [];

    const result = await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications: [createWriteBack()],
      onError: (error) => {
        errors.push(String(error));
      },
      store: harness.store,
    });

    expect(result.failed).toBe(1);
    expect(errors.length).toBe(1);
  });

  /*
   * The pass either pushes or writes back, so a classification nobody can act on holds
   * the destination's ordinary pushes for as long as it keeps reclassifying. Spending the
   * budget against the mapping is what ends that hold: the classifier refuses the mapping
   * once the budget is gone and the push resumes.
   */
  it("spends the budget on an unloadable mapping so the pushes are not held forever", async () => {
    const harness = createHarness({ target: null });

    for (let pass = 0; pass < TWO_WAY_EPOCH_QUARANTINE_LIMIT; pass += 1) {
      await runWriteBackPass({
        calendarId: DESTINATION_CALENDAR_ID,
        classifications: [createWriteBack()],
        store: harness.store,
      });
    }

    expect(harness.failures).toEqual(
      Array.from({ length: TWO_WAY_EPOCH_QUARANTINE_LIMIT }, () => MAPPING_ID),
    );
  });
});
