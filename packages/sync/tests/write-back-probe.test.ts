import { describe, expect, it } from "vitest";
import type {
  CalendarSourceWriter,
  InboundClassification,
  RemoteEventPresence,
} from "@keeper.sh/calendar";
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
const SOURCE_EVENT_UID = "source-event-uid-1";
const DESTINATION_EVENT_UID = "destination-uid-1";
const DELETE_IDENTIFIER = "destination-delete-id-1";
const START_TIME = new Date("2027-05-11T14:00:00.000Z");
const END_TIME = new Date("2027-05-11T15:00:00.000Z");
const PUSHED_HASH = "the-hash-of-what-we-last-pushed";
const TRUNCATED_MIRROR_COUNT = 5;
const PASSES_PAST_GRACE = 20;

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

const createTarget = (mappingId: string): WriteBackTarget => ({
  deleteIdentifier: `${DELETE_IDENTIFIER}-${mappingId}`,
  destinationCalendarId: DESTINATION_CALENDAR_ID,
  destinationEventUid: `${DESTINATION_EVENT_UID}-${mappingId}`,
  eventStateId: `${EVENT_STATE_ID}-${mappingId}`,
  mappingId,
  sourceCalendarId: SOURCE_CALENDAR_ID,
  sourceEventId: null,
  sourceEventUid: `${SOURCE_EVENT_UID}-${mappingId}`,
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
  sourceEventUid: `${SOURCE_EVENT_UID}-${mappingId}`,
  type: "delete",
});

interface ProbeHarnessOptions {
  omitProbe?: boolean;
  probe?: (target: WriteBackTarget) => Promise<RemoteEventPresence>;
}

const createHarness = (options: ProbeHarnessOptions = {}) => {
  const log: string[] = [];
  const probedUids: string[] = [];
  const writerCalls: string[] = [];
  const tombstones = new Map<string, { state: string }>();
  const sourceEvents = new Map<string, SourceEventSnapshot>();
  let tombstoneCounter = 0;

  const writer: CalendarSourceWriter = {
    deleteEvent: (reference) => {
      log.push("provider:delete");
      writerCalls.push(reference.sourceEventUid);
      return Promise.resolve({ success: true });
    },
    updateEvent: () => {
      log.push("provider:update");
      return Promise.resolve({ success: true });
    },
  };

  const locked: LockedWriteBackStore = {
    commitDelete: ({ eventStateId, tombstoneId }) => {
      log.push("commit:delete");
      sourceEvents.delete(eventStateId);
      tombstones.set(tombstoneId, { state: "applied" });
      return Promise.resolve();
    },
    commitUpdate: () => {
      log.push("commit:update");
      return Promise.resolve({ writeBackEpoch: 1 });
    },
    readMappingSyncEventHash: () => Promise.resolve({ syncEventHash: PUSHED_HASH }),
    readPairWriteBack: () =>
      Promise.resolve({ writeBackMode: "edits_and_deletes", writeBackState: "ok" }),
    readSourceEvent: (eventStateId) =>
      Promise.resolve(sourceEvents.get(eventStateId) ?? null),
  };

  const probe = options.probe
    ?? (() => Promise.resolve<RemoteEventPresence>("absent"));

  const store: WriteBackStore = {
    abandonTombstone: ({ tombstoneId }) => {
      log.push("tombstone:abandon");
      tombstones.set(tombstoneId, { state: "abandoned" });
      return Promise.resolve();
    },
    countRecentDeletes: () => Promise.resolve(0),
    loadTarget: (mappingId) => Promise.resolve(createTarget(mappingId)),
    notifySiblings: () => Promise.resolve(),
    quarantineMapping: () => Promise.resolve(),
    readSourceEvent: (eventStateId) =>
      Promise.resolve(sourceEvents.get(eventStateId) ?? null),
    recordFailure: () => Promise.resolve(1),
    recordTombstone: () => {
      log.push("tombstone:commit");
      tombstoneCounter += 1;
      const id = `tombstone-${tombstoneCounter}`;
      tombstones.set(id, { state: "pending" });
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
    ...(!options.omitProbe && {
      probeDestinationEvent: (target: WriteBackTarget) => {
        log.push("probe");
        probedUids.push(target.destinationEventUid ?? "");
        return probe(target);
      },
    }),
  };

  const seed = (mappingId: string): void => {
    sourceEvents.set(`${EVENT_STATE_ID}-${mappingId}`, createSourceEvent());
  };

  return { log, probedUids, seed, sourceEvents, store, tombstones, writerCalls };
};

const appliedTombstones = (
  tombstones: Map<string, { state: string }>,
): number =>
  [...tombstones.values()].filter((tombstone) => tombstone.state === "applied").length;

describe("two-way sync: absence from a list is never evidence of a deletion", () => {
  it("deletes nothing while a targeted read still finds the copies a truncated list omitted", async () => {
    const harness = createHarness({
      probe: () => Promise.resolve<RemoteEventPresence>("present"),
    });
    const mappingIds = Array.from(
      { length: TRUNCATED_MIRROR_COUNT },
      (_value, index) => `mapping-id-${index}`,
    );
    for (const mappingId of mappingIds) {
      harness.seed(mappingId);
    }

    for (let pass = 0; pass < PASSES_PAST_GRACE; pass += 1) {
      await runWriteBackPass({
        calendarId: DESTINATION_CALENDAR_ID,
        classifications: mappingIds.map((mappingId) => createDelete(mappingId)),
        store: harness.store,
      });
    }

    expect(harness.writerCalls).toEqual([]);
    expect(appliedTombstones(harness.tombstones)).toBe(0);
    expect(harness.sourceEvents.size).toBe(TRUNCATED_MIRROR_COUNT);
  });

  it("commits no record for a deletion the probe vetoed", async () => {
    const harness = createHarness({
      probe: () => Promise.resolve<RemoteEventPresence>("present"),
    });
    harness.seed("mapping-id-0");

    await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications: [createDelete("mapping-id-0")],
      store: harness.store,
    });

    expect(harness.log).not.toContain("tombstone:commit");
    expect(harness.log).not.toContain("provider:delete");
  });

  it("probes each candidate before the record is committed and before the lock is taken", async () => {
    const harness = createHarness();
    harness.seed("mapping-id-0");

    await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications: [createDelete("mapping-id-0")],
      store: harness.store,
    });

    expect(harness.log).toEqual([
      "probe",
      "tombstone:commit",
      "lock:acquire",
      "provider:delete",
      "commit:delete",
      "lock:release",
    ]);
  });

  it("probes the specific copy it is about to destroy the original of", async () => {
    const harness = createHarness();
    harness.seed("mapping-id-7");

    await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications: [createDelete("mapping-id-7")],
      store: harness.store,
    });

    expect(harness.probedUids).toEqual([`${DESTINATION_EVENT_UID}-mapping-id-7`]);
  });
});

describe("two-way sync: an indeterminate probe fails closed", () => {
  it("abandons the deletion when the probe throws", async () => {
    const harness = createHarness({
      probe: () => Promise.reject(new Error("destination unreachable")),
    });
    harness.seed("mapping-id-0");

    const result = await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications: [createDelete("mapping-id-0")],
      store: harness.store,
    });

    expect(harness.writerCalls).toEqual([]);
    expect(harness.sourceEvents.size).toBe(1);
    expect(result.applied).toBe(0);
  });

  it("refuses every deletion when the destination provider cannot probe at all", async () => {
    const harness = createHarness({ omitProbe: true });
    harness.seed("mapping-id-0");

    await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications: [createDelete("mapping-id-0")],
      store: harness.store,
    });

    expect(harness.writerCalls).toEqual([]);
    expect(harness.sourceEvents.size).toBe(1);
  });

  it("lets a confirmed absence proceed while a vetoed sibling in the same pass does not", async () => {
    const vetoed = "mapping-id-vetoed";
    const confirmed = "mapping-id-confirmed";
    const harness = createHarness({
      probe: (target) => {
        if (target.mappingId === vetoed) {
          return Promise.resolve<RemoteEventPresence>("present");
        }
        return Promise.resolve<RemoteEventPresence>("absent");
      },
    });
    harness.seed(vetoed);
    harness.seed(confirmed);

    await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications: [createDelete(vetoed), createDelete(confirmed)],
      store: harness.store,
    });

    expect(harness.writerCalls).toEqual([`${SOURCE_EVENT_UID}-${confirmed}`]);
    expect(harness.sourceEvents.has(`${EVENT_STATE_ID}-${vetoed}`)).toBe(true);
    expect(harness.sourceEvents.has(`${EVENT_STATE_ID}-${confirmed}`)).toBe(false);
  });

  it("re-probes rather than trusting a pending record left by an earlier crash", async () => {
    const presence: RemoteEventPresence[] = ["absent", "present"];
    const harness = createHarness({
      probe: () => Promise.resolve(presence.shift() ?? "present"),
    });
    harness.seed("mapping-id-0");

    await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications: [createDelete("mapping-id-0")],
      store: harness.store,
    });
    harness.seed("mapping-id-0");
    harness.writerCalls.length = 0;

    await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications: [createDelete("mapping-id-0")],
      store: harness.store,
    });

    expect(harness.writerCalls).toEqual([]);
    expect(harness.probedUids.length).toBe(2);
  });
});
