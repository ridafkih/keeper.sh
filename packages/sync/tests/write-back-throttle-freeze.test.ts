import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyInboundChanges,
  createEditableEventContentHash,
  createGoogleSourceWriter,
  createSyncEventContentHash,
  normalizeText,
  resolveIsAllDayEvent,
  TWO_WAY_EPOCH_QUARANTINE_LIMIT,
  TWO_WAY_FAILURE_EPOCH_QUARANTINE_LIMIT,
} from "@keeper.sh/calendar";
import type {
  CalendarSourceWriter,
  MaterializedSyncableEvent,
  RemoteEvent,
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
const MAPPING_ID = "mapping-id-1";
const EVENT_STATE_ID = "event-state-id-1";
const SOURCE_EVENT_UID = "source-event-uid-1";
const START_TIME = new Date("2027-05-11T14:00:00.000Z");
const END_TIME = new Date("2027-05-11T15:00:00.000Z");
const MOVED_START_TIME = new Date("2027-05-11T17:00:00.000Z");
const MOVED_END_TIME = new Date("2027-05-11T18:00:00.000Z");
const NOW = new Date("2027-05-01T12:00:00.000Z");
const OK = 200;
const TOO_MANY_REQUESTS = 429;
const NONE = 0;
const ONE = 1;

const TEST_WINDOW = {
  timeMax: new Date("2100-01-01T00:00:00.000Z"),
  timeMin: new Date("2000-01-01T00:00:00.000Z"),
};

const SOURCE_EVENT: SourceEventSnapshot = {
  description: "Bring the notes",
  endTime: END_TIME,
  isAllDay: null,
  location: "Room 4",
  startTime: START_TIME,
  startTimeZone: null,
  title: "Quarterly review",
};

const createLocalEvent = (): MaterializedSyncableEvent => ({
  availability: "busy",
  calendarId: SOURCE_CALENDAR_ID,
  calendarName: "Personal",
  calendarUrl: null,
  description: "Bring the notes",
  endTime: END_TIME,
  eventStateId: EVENT_STATE_ID,
  id: EVENT_STATE_ID,
  location: "Room 4",
  sourceEventUid: SOURCE_EVENT_UID,
  startTime: START_TIME,
  summary: "Quarterly review",
});

const createMapping = (
  event: MaterializedSyncableEvent,
  epoch: number,
  lastAppliedAt: Date | null = null,
) => ({
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier: "destination-delete-id-1",
  destinationAvailability: "busy" as const,
  destinationContentHash: createEditableEventContentHash(event),
  destinationDescription: normalizeText(event.description),
  destinationEndTime: event.endTime,
  destinationEventUid: "destination-uid-1",
  destinationIsAllDay: resolveIsAllDayEvent({
    endTime: event.endTime,
    startTime: event.startTime,
  }),
  destinationLocation: normalizeText(event.location),
  destinationStartTime: event.startTime,
  destinationSummary: normalizeText(event.summary),
  endTime: event.endTime,
  eventStateId: event.eventStateId ?? event.id,
  id: MAPPING_ID,
  missingFirstObservedAt: null,
  missingObservationCount: 0,
  recurrenceId: null,
  recurrenceRule: null,
  sourceCalendarId: SOURCE_CALENDAR_ID,
  startTime: event.startTime,
  syncEventHash: createSyncEventContentHash(event),
  syncEventId: event.id,
  writeBackDailyCount: 0,
  writeBackDailyWindowStart: null,
  writeBackEpoch: epoch,
  /*
   * Stamped by recordFailure on the failure just taken, so the window is live: the point
   * under test is what a live, spent budget does, not what an expired one does.
   */
  writeBackEpochWindowStart: NOW,
  writeBackLastAppliedAt: lastAppliedAt,
});

const createMovedRemoteEvent = (
  mapping: ReturnType<typeof createMapping>,
): RemoteEvent => ({
  deleteId: mapping.deleteIdentifier,
  editableAvailability: "busy",
  editableContentHash: createEditableEventContentHash(createLocalEvent()),
  editableFields: {
    description: "Bring the notes",
    isAllDay: false,
    location: "Room 4",
    summary: "Quarterly review",
  },
  endTime: MOVED_END_TIME,
  isKeeperEvent: true,
  startTime: MOVED_START_TIME,
  supportedAvailabilities: ["busy", "free"],
  uid: mapping.destinationEventUid,
});

/*
 * The real classifier, handed the mapping exactly as the failure bookkeeping left it. This
 * is the half the pass-level fixtures cannot see: whether the pass is ever handed the work
 * again once the throttle has spent the mapping's failure budget.
 */
const classifyWithEpoch = (epoch: number, lastAppliedAt: Date | null = null) => {
  const event = createLocalEvent();
  const mapping = createMapping(event, epoch, lastAppliedAt);
  return classifyInboundChanges({
    existingMappings: [mapping],
    localEvents: [event],
    now: NOW,
    remoteEvents: [createMovedRemoteEvent(mapping)],
    remoteRawItemCount: 1,
    scope: {
      authoritativeWindow: TEST_WINDOW,
      requestedWindow: TEST_WINDOW,
      writeBackPolicies: new Map([[SOURCE_CALENDAR_ID, {
        deleteApproved: false,
        destinationCalendarId: DESTINATION_CALENDAR_ID,
        excludeEventDescription: false,
        excludeEventLocation: false,
        excludeEventName: false,
        paused: false,
        sourceCalendarId: SOURCE_CALENDAR_ID,
        writeBackMode: "edits" as const,
      }]]),
    },
  });
};

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

const THROTTLED_BODY = JSON.stringify({
  error: { code: TOO_MANY_REQUESTS, message: "Rate Limit Exceeded" },
});

const createHarness = () => {
  const throttle = { on: true };
  const patched: string[] = [];
  const quarantines: string[] = [];
  const landed: string[] = [];
  const epoch = { spent: NONE };
  const pair = { writeBackState: "ok" };

  globalThis.fetch = vi.fn((input: unknown, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const url = String(input);
    if (method === "GET") {
      const [, sourceEventUid] = /iCalUID=([^&]+)/.exec(url) ?? [];
      return Promise.resolve(
        Response.json(
          {
            items: [{
              iCalUID: decodeURIComponent(sourceEventUid ?? ""),
              id: decodeURIComponent(sourceEventUid ?? ""),
            }],
          },
          { status: OK },
        ),
      );
    }
    patched.push(decodeURIComponent(url.split("/").pop() ?? ""));
    if (!throttle.on) {
      landed.push(MAPPING_ID);
      return Promise.resolve(Response.json({ id: SOURCE_EVENT_UID }, { status: OK }));
    }
    return Promise.resolve(
      new Response(THROTTLED_BODY, {
        headers: { "content-type": "application/json", "retry-after": "60" },
        status: TOO_MANY_REQUESTS,
      }),
    );
  }) as unknown as typeof fetch;

  const writer: CalendarSourceWriter = createGoogleSourceWriter({
    accessToken: () => Promise.resolve("token"),
    externalCalendarId: "primary",
  });

  const locked: LockedWriteBackStore = {
    commitDelete: () => Promise.resolve(),
    commitUpdate: () => Promise.resolve({ writeBackDailyCount: ONE, writeBackEpoch: ONE }),
    readMappingSyncEventHash: () =>
      Promise.resolve({ syncEventHash: createSyncEventContentHash(createLocalEvent()) }),
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
    loadTarget: () => Promise.resolve(createTarget()),
    notifySiblings: () => Promise.resolve(),
    probeDestinationEvent: () => Promise.resolve("present"),
    quarantineMapping: (_source, _destination, reason) => {
      quarantines.push(reason);
      pair.writeBackState = "quarantined";
      return Promise.resolve();
    },
    readSourceEvent: () => Promise.resolve(SOURCE_EVENT),
    /*
     * The real recordFailure increments the mapping's writeBackEpoch, which is the very
     * column the classifier reads back on the next pass.
     */
    recordFailure: () => {
      epoch.spent += ONE;
      return Promise.resolve(epoch.spent);
    },
    recordTombstone: () =>
      Promise.resolve({ id: "tombstone-1", observedAt: new Date(), priorAttempt: false }),
    requestDeleteConfirmation: () => Promise.resolve(),
    resolveWriter: () => Promise.resolve(writer),
    withSourceLock: (_sourceCalendarId, run) => run(locked),
  };

  return { epoch, landed, pair, patched, quarantines, store, throttle };
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const runThrottledPasses = async (
  harness: ReturnType<typeof createHarness>,
  passes: number,
): Promise<void> => {
  for (let pass = NONE; pass < passes; pass += ONE) {
    const { classifications } = classifyWithEpoch(harness.epoch.spent);
    await runWriteBackPass({
      calendarId: DESTINATION_CALENDAR_ID,
      classifications,
      onError: () => {
        /* The throttle is the fixture; the assertions read the writer and the pair. */
      },
      store: harness.store,
    });
  }
};

/*
 * The failure budget is what the applier escalates on, and the classifier is what decides
 * whether the applier is handed the work at all. They read the same counter against
 * different limits, so between the two of them a throttled mapping can stop being retried
 * long before anything escalates.
 */
describe("a throttled write-back does not silently freeze the event", () => {
  it("keeps handing the pass the edit while the mapping's budget is still being spent", async () => {
    const harness = createHarness();

    await runThrottledPasses(harness, TWO_WAY_EPOCH_QUARANTINE_LIMIT - ONE);

    expect(harness.patched.length).toBe(TWO_WAY_EPOCH_QUARANTINE_LIMIT - ONE);
    expect(classifyWithEpoch(harness.epoch.spent).classifications.map(({ type }) => type))
      .toEqual(["write-back"]);
  });

  it("either keeps retrying or tells the user, once the throttle has spent the budget", async () => {
    const harness = createHarness();

    await runThrottledPasses(harness, TWO_WAY_EPOCH_QUARANTINE_LIMIT);

    const next = classifyWithEpoch(harness.epoch.spent);
    const stillRetried = next.classifications.some(({ type }) => type === "write-back");
    const toldTheUser = harness.pair.writeBackState !== "ok";

    /*
     * The mapping is also in suppressedMappingIds and its witness has been rewritten to the
     * copy's edited values, so the one-way repair does not run either: the event is frozen
     * on both sides. That half only becomes permanent because nothing above ever escalates,
     * which is what these two fields pin.
     */
    expect(next.suppressedMappingIds).toEqual([MAPPING_ID]);
    expect({
      classifications: next.classifications.map(({ type }) => type),
      resolved: stillRetried || toldTheUser,
    }).toEqual({
      classifications: ["write-back"],
      resolved: true,
    });
  });

  it("still writes the edit back once the provider stops throttling", async () => {
    const harness = createHarness();

    await runThrottledPasses(harness, TWO_WAY_EPOCH_QUARANTINE_LIMIT * 2);
    expect(harness.landed).toEqual([]);
    harness.throttle.on = false;
    await runThrottledPasses(harness, ONE);

    expect(harness.landed).toEqual([MAPPING_ID]);
    expect(harness.pair.writeBackState).toBe("ok");
  });

  it("pauses the pair and says so once the failure budget really is spent", async () => {
    const harness = createHarness();

    await runThrottledPasses(harness, TWO_WAY_FAILURE_EPOCH_QUARANTINE_LIMIT);

    expect(harness.quarantines).toEqual(["write_back_failing"]);
    expect(harness.pair.writeBackState).toBe("quarantined");
  });

  /*
   * The longer budget is for spends nothing landed from. A mapping whose budget went on
   * writes that reached the source is a runaway, and five remains the most it may ever land.
   */
  it("still stops at five when the budget went on writes that landed", () => {
    const landedAfterTheWindowOpened = new Date(NOW.getTime() + ONE);
    const next = classifyWithEpoch(
      TWO_WAY_EPOCH_QUARANTINE_LIMIT,
      landedAfterTheWindowOpened,
    );

    expect(next.classifications.map(({ type }) => type)).toEqual(["rejected"]);
  });
});
