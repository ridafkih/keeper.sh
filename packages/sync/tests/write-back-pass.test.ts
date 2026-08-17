import { describe, expect, it } from "vitest";
import { getErrorMessage, TWO_WAY_EPOCH_QUARANTINE_LIMIT } from "@keeper.sh/calendar";
import type {
  CalendarSourceWriter,
  InboundClassification,
  SourceEventUpdate,
} from "@keeper.sh/calendar";
import { TWO_WAY_DELETE_DAILY_CAP, TWO_WAY_WRITE_BACK_PASS_BUDGET_MS } from "@keeper.sh/constants";
import { MAX_WRITE_BACKS_PER_PASS, runWriteBackPass } from "../src/write-back-pass";
import type {
  LockedWriteBackStore,
  SourceEventSnapshot,
  WriteBackStore,
  WriteBackTarget,
} from "../src/write-back-pass";

const SOURCE_CALENDAR_ID = "source-calendar-id";
const DESTINATION_CALENDAR_ID = "destination-calendar-id";
const SIBLING_CALENDAR_ID = "sibling-calendar-id";
const MAPPING_ID = "mapping-id-1";
const EVENT_STATE_ID = "event-state-id-1";
const SOURCE_EVENT_UID = "source-event-uid-1";
const START_TIME = new Date("2027-05-11T14:00:00.000Z");
const END_TIME = new Date("2027-05-11T15:00:00.000Z");
const MOVED_START_TIME = new Date("2027-05-11T17:00:00.000Z");
const MOVED_END_TIME = new Date("2027-05-11T18:00:00.000Z");
const NOW = new Date("2027-05-01T12:00:00.000Z");

const createSourceEvent = (
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

const PUSHED_HASH = "the-hash-of-what-we-last-pushed";

const createTarget = (overrides: Partial<WriteBackTarget> = {}): WriteBackTarget => ({
  destinationCalendarId: DESTINATION_CALENDAR_ID,
  eventStateId: EVENT_STATE_ID,
  mappingId: MAPPING_ID,
  sourceCalendarId: SOURCE_CALENDAR_ID,
  sourceEventId: null,
  sourceEventUid: SOURCE_EVENT_UID,
  ...overrides,
});

const createWriteBack = (
  overrides: Partial<Extract<InboundClassification, { type: "write-back" }>> = {},
): InboundClassification => ({
  expectedSource: { endTime: END_TIME, isAllDay: false, startTime: START_TIME },
  expectedSyncEventHash: PUSHED_HASH,
  mappingId: MAPPING_ID,
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
  sourceEventUid: SOURCE_EVENT_UID,
  type: "write-back",
  updates: { endTime: MOVED_END_TIME, isAllDay: false, startTime: MOVED_START_TIME },
  ...overrides,
});

const createDelete = (
  overrides: Partial<Extract<InboundClassification, { type: "delete" }>> = {},
): InboundClassification => ({
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
  ...overrides,
});

interface HarnessOptions {
  mappingHash?: string | null;
  recentDeletes?: number;
  sourceEvent?: SourceEventSnapshot | null;
  targets?: Map<string, WriteBackTarget>;
  writerFailure?: string;
  writerLatencyMs?: number;
}

const createHarness = (options: HarnessOptions = {}) => {
  const log: string[] = [];
  const tombstones = new Map<string, { snapshot: SourceEventSnapshot; state: string }>();
  const writerCalls: { type: string; updates?: SourceEventUpdate }[] = [];
  const quarantines: { reason: string; sourceCalendarId: string }[] = [];
  const notified: string[] = [];
  const state = {
    epoch: 0,
    mappingHash: PUSHED_HASH as string | null,
    sourceEvent: createSourceEvent() as SourceEventSnapshot | null,
    ...("mappingHash" in options && { mappingHash: options.mappingHash ?? null }),
    ...("sourceEvent" in options && { sourceEvent: options.sourceEvent ?? null }),
  };
  let clock = NOW.getTime();
  let tombstoneCounter = 0;

  const writer: CalendarSourceWriter = {
    deleteEvent: () => {
      log.push("provider:delete");
      writerCalls.push({ type: "delete" });
      clock += options.writerLatencyMs ?? 0;
      if (options.writerFailure) {
        return Promise.resolve({ error: options.writerFailure, success: false });
      }
      return Promise.resolve({ success: true });
    },
    updateEvent: (_reference, updates) => {
      log.push("provider:update");
      writerCalls.push({ type: "update", updates });
      clock += options.writerLatencyMs ?? 0;
      if (options.writerFailure) {
        return Promise.resolve({ error: options.writerFailure, success: false });
      }
      return Promise.resolve({ success: true });
    },
  };

  const locked: LockedWriteBackStore = {
    commitDelete: ({ tombstoneId }) => {
      log.push("commit:delete");
      state.sourceEvent = null;
      const tombstone = tombstones.get(tombstoneId);
      if (tombstone) {
        tombstones.set(tombstoneId, { ...tombstone, state: "applied" });
      }
      return Promise.resolve();
    },
    commitUpdate: () => {
      log.push("commit:update");
      state.epoch += 1;
      return Promise.resolve({ writeBackAppliedCount: state.epoch });
    },
    readMappingSyncEventHash: () => Promise.resolve({ syncEventHash: state.mappingHash }),
    readPairWriteBack: () =>
      Promise.resolve({ writeBackMode: "edits_and_deletes", writeBackState: "ok" }),
    readSourceEvent: () => Promise.resolve(state.sourceEvent),
  };

  const store: WriteBackStore = {
    abandonTombstone: ({ tombstoneId }) => {
      log.push("tombstone:abandon");
      const tombstone = tombstones.get(tombstoneId);
      if (tombstone) {
        tombstones.set(tombstoneId, { ...tombstone, state: "abandoned" });
      }
      return Promise.resolve();
    },
    countRecentDeletes: () => Promise.resolve(options.recentDeletes ?? 0),
    loadTarget: (mappingId) =>
      Promise.resolve(options.targets?.get(mappingId) ?? createTarget({ mappingId })),
    probeDestinationEvent: () => Promise.resolve("absent"),
    notifySiblings: (sourceCalendarId) => {
      log.push("notify:siblings");
      notified.push(sourceCalendarId);
      return Promise.resolve();
    },
    quarantineMapping: (sourceCalendarId, _destinationCalendarId, reason) => {
      log.push("quarantine");
      quarantines.push({ reason, sourceCalendarId });
      return Promise.resolve();
    },
    readSourceEvent: () => Promise.resolve(state.sourceEvent),
    recordFailure: () => {
      log.push("failure:record");
      state.epoch += 1;
      return Promise.resolve(state.epoch);
    },
    recordTombstone: ({ snapshot }) => {
      log.push("tombstone:commit");
      tombstoneCounter += 1;
      const id = `tombstone-${tombstoneCounter}`;
      tombstones.set(id, { snapshot, state: "pending" });
      return Promise.resolve({ id, observedAt: new Date(), priorAttempt: false });
    },
    resolveWriter: () => Promise.resolve(writer),
    withSourceLock: async (_sourceCalendarId, run) => {
      log.push("lock:acquire");
      try {
        return await run(locked);
      } finally {
        log.push("lock:release");
      }
    },
  };

  return {
    log,
    notified,
    quarantines,
    readClock: () => new Date(clock),
    state,
    store,
    tombstones,
    writerCalls,
  };
};

describe("runWriteBackPass: nothing is destroyed without a record of it", () => {
  it("commits the tombstone before the provider is asked to delete, and outside the lock", async () => {
    const harness = createHarness();

    await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications: [createDelete()],
      store: harness.store,
    });

    expect(harness.log).toEqual([
      "tombstone:commit",
      "lock:acquire",
      "provider:delete",
      "commit:delete",
      "lock:release",
      "notify:siblings",
    ]);
  });

  it("keeps the real source content in the record, not the redacted mirror", async () => {
    const harness = createHarness({
      sourceEvent: createSourceEvent({ title: "Root canal, Dr. Chen" }),
    });

    await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications: [createDelete({
        expectedSource: {
          description: "Bring the notes",
          endTime: END_TIME,
          isAllDay: false,
          location: "Room 4",
          startTime: START_TIME,
          summary: "Root canal, Dr. Chen",
        },
      })],
      store: harness.store,
    });

    expect([...harness.tombstones.values()]).toMatchObject([{
      snapshot: { description: "Bring the notes", title: "Root canal, Dr. Chen" },
      state: "applied",
    }]);
  });

  it("never calls the provider when the record cannot be committed", async () => {
    const harness = createHarness();
    const store: WriteBackStore = {
      ...harness.store,
      recordTombstone: () => Promise.reject(new Error("tombstone insert failed")),
    };

    const result = await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications: [createDelete()],
      store,
    });

    expect(result.failed).toBe(1);
    expect(harness.writerCalls).toEqual([]);
  });

  it("abandons the record rather than the event when the source moved under the lock", async () => {
    const harness = createHarness({ mappingHash: "a-hash-from-a-later-push" });

    const result = await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications: [createDelete()],
      store: harness.store,
    });

    expect(result).toMatchObject({ abandoned: 1, applied: 0 });
    expect(harness.writerCalls).toEqual([]);
    expect([...harness.tombstones.values()]).toMatchObject([{ state: "abandoned" }]);
  });
});

describe("runWriteBackPass: the state under the lock must be the state we classified", () => {
  it("abandons when a sibling destination already wrote the same field", async () => {
    const harness = createHarness({
      sourceEvent: createSourceEvent({
        endTime: MOVED_END_TIME,
        startTime: MOVED_START_TIME,
      }),
    });

    const result = await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications: [createWriteBack()],
      store: harness.store,
    });

    expect(result).toMatchObject({ abandoned: 1, applied: 0 });
    expect(harness.writerCalls).toEqual([]);
  });

  it("abandons when the source event changed on an axis the payload writes", async () => {
    const harness = createHarness({
      sourceEvent: createSourceEvent({ title: "Renamed on the source" }),
    });

    const result = await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications: [createWriteBack({
        expectedSource: { summary: "Quarterly review" },
        updates: { summary: "Renamed on the destination" },
      })],
      store: harness.store,
    });

    expect(result).toMatchObject({ abandoned: 1 });
    expect(harness.writerCalls).toEqual([]);
  });

  it("proceeds when the source changed only on an axis the payload leaves alone", async () => {
    const harness = createHarness({
      sourceEvent: createSourceEvent({ location: "Room 9" }),
    });

    const result = await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications: [createWriteBack({
        expectedSource: { summary: "Quarterly review" },
        updates: { summary: "Renamed on the destination" },
      })],
      store: harness.store,
    });

    expect(result).toMatchObject({ applied: 1 });
    expect(harness.writerCalls).toMatchObject([{ type: "update" }]);
  });

  it("abandons when the source row has gone entirely", async () => {
    const harness = createHarness({ sourceEvent: null });

    const result = await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications: [createWriteBack()],
      store: harness.store,
    });

    expect(result).toMatchObject({ abandoned: 1 });
    expect(harness.writerCalls).toEqual([]);
  });
});

describe("runWriteBackPass: the budget bounds the pass", () => {
  it("stops at the per-pass application cap", async () => {
    const harness = createHarness();
    const classifications = Array.from(
      { length: MAX_WRITE_BACKS_PER_PASS + 10 },
      (_value, index) => createWriteBack({ mappingId: `mapping-id-${index}` }),
    );

    const result = await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications,
      store: harness.store,
    });

    expect(result.applied + result.abandoned + result.quarantined + result.withheld).toBe(
      MAX_WRITE_BACKS_PER_PASS,
    );
  });

  it("stops once the wall-clock budget is spent and persists no queue", async () => {
    const harness = createHarness({ writerLatencyMs: TWO_WAY_WRITE_BACK_PASS_BUDGET_MS / 2 });
    const classifications = Array.from(
      { length: 10 },
      (_value, index) => createWriteBack({ mappingId: `mapping-id-${index}` }),
    );

    const result = await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications,
      now: harness.readClock,
      store: harness.store,
    });

    expect(result.applied).toBeLessThan(classifications.length);
    expect(result.applied).toBeGreaterThan(0);
  });

  it("reports a provider failure rather than swallowing it", async () => {
    const harness = createHarness({ writerFailure: "Google said no" });
    const errors: string[] = [];

    const result = await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications: [createWriteBack()],
      onError: (error) => {
        errors.push(getErrorMessage(error));
      },
      store: harness.store,
    });

    expect(result.failed).toBe(1);
    expect(errors).toEqual(["Google said no"]);
  });
});

describe("runWriteBackPass: a runaway destination is quarantined", () => {
  it("quarantines the mapping the moment the epoch budget is spent", async () => {
    const harness = createHarness();
    harness.state.epoch = TWO_WAY_EPOCH_QUARANTINE_LIMIT - 1;

    const result = await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications: [createWriteBack()],
      store: harness.store,
    });

    /*
     * The write reached the real calendar and the stop fired on the way out, so the pass
     * counts it as applied. The pair pausing is the assertion below it: that is where the
     * quarantine is recorded, and it is the fact a user or an operator acts on.
     */
    expect(result).toMatchObject({ applied: 1 });
    expect(harness.quarantines).toEqual([
      { reason: "runaway_write_back", sourceCalendarId: SOURCE_CALENDAR_ID },
    ]);
  });

  it("does not quarantine a healthy mapping", async () => {
    const harness = createHarness();

    await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications: [createWriteBack()],
      store: harness.store,
    });

    expect(harness.quarantines).toEqual([]);
  });

  it("refuses a deletion once the day's cap is spent, without touching the provider", async () => {
    const harness = createHarness({ recentDeletes: TWO_WAY_DELETE_DAILY_CAP });

    const result = await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications: [createDelete()],
      store: harness.store,
    });

    expect(result).toMatchObject({ applied: 0, quarantined: 1 });
    expect(harness.writerCalls).toEqual([]);
    expect(harness.tombstones.size).toBe(0);
    expect(harness.quarantines).toEqual([
      { reason: "delete_daily_cap", sourceCalendarId: SOURCE_CALENDAR_ID },
    ]);
  });

  it("still deletes while the day's cap has room", async () => {
    const harness = createHarness({ recentDeletes: TWO_WAY_DELETE_DAILY_CAP - 1 });

    const result = await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications: [createDelete()],
      store: harness.store,
    });

    expect(result).toMatchObject({ applied: 1 });
  });
});

describe("runWriteBackPass: the other destinations of the source are told", () => {
  it("invalidates the siblings once, after the source write lands", async () => {
    const harness = createHarness();

    await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications: [
        createWriteBack({ mappingId: "mapping-id-a" }),
        createWriteBack({ mappingId: "mapping-id-b" }),
      ],
      store: harness.store,
    });

    expect(harness.notified).toEqual([SOURCE_CALENDAR_ID]);
    expect(harness.log.at(-1)).toBe("notify:siblings");
  });

  it("does not notify when nothing was written", async () => {
    const harness = createHarness({ mappingHash: "a-hash-from-a-later-push" });

    await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications: [createWriteBack()],
      store: harness.store,
    });

    expect(harness.notified).toEqual([]);
  });

  it("ignores classifications that are not the applier's to act on", async () => {
    const harness = createHarness({
      targets: new Map([[MAPPING_ID, createTarget({ destinationCalendarId: SIBLING_CALENDAR_ID })]]),
    });

    const result = await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications: [
        { mappingId: MAPPING_ID, missingObservationCount: 0, type: "none" },
        { mappingId: MAPPING_ID, resolution: "source-wins", type: "conflict" },
      ],
      store: harness.store,
    });

    expect(result).toEqual({
      abandoned: 0,
      applied: 0,
      failed: 0,
      heldForGrant: 0,
      quarantined: 0,
      withheld: 0,
    });
    expect(harness.log).toEqual([]);
  });
});

describe("runWriteBackPass: a write-back that keeps failing stops being retried", () => {
  it("spends the epoch budget on failures and quarantines the mapping", async () => {
    const harness = createHarness({ writerFailure: "Google said no" });
    harness.state.epoch = TWO_WAY_EPOCH_QUARANTINE_LIMIT - 1;

    const result = await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications: [createWriteBack()],
      store: harness.store,
    });

    expect(result).toMatchObject({ failed: 1, quarantined: 1 });
    expect(harness.quarantines).toEqual([
      { reason: "write_back_failing", sourceCalendarId: SOURCE_CALENDAR_ID },
    ]);
  });

  it("leaves a first failure alone so a transient error can retry", async () => {
    const harness = createHarness({ writerFailure: "Google said no" });

    const result = await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications: [createWriteBack()],
      store: harness.store,
    });

    expect(result).toMatchObject({ failed: 1, quarantined: 0 });
    expect(harness.quarantines).toEqual([]);
  });
});
