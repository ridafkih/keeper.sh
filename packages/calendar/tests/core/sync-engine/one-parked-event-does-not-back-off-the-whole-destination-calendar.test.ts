import { describe, expect, it } from "vitest";
import { executeRemoteOperations, syncCalendar } from "../../../src/core/sync-engine/index";
import { resolveDestinationAttemptVerdict } from "../../../../sync/src/destination-errors";
import { createSyncEventContentHash } from "../../../src/core/events/content-hash";
import type { CalendarSyncProvider } from "../../../src/core/sync-engine/types";
import type { EventMapping } from "../../../src/core/events/mappings";
import type {
  EventPresence,
  MaterializedSyncableEvent,
  PushResult,
  RemoteEvent,
  SyncOperation,
} from "../../../src/core/types";

const DESTINATION_CALENDAR_ID = "dest-cal-1";
const SOURCE_CALENDAR_ID = "source-cal-1";
const USER_ID = "user-1";

const START_TIME = new Date("2026-05-12T09:00:00.000Z");
const END_TIME = new Date("2026-05-12T10:00:00.000Z");

const ROLLED_PAST_WINDOW = {
  timeMax: new Date("2026-09-01T00:00:00.000Z"),
  timeMin: new Date("2026-08-01T00:00:00.000Z"),
};

const WIDE_WINDOW = {
  timeMax: new Date("2027-01-01T00:00:00.000Z"),
  timeMin: new Date("2026-01-01T00:00:00.000Z"),
};

const createScope = (requestedWindow: { timeMax: Date; timeMin: Date }) => ({
  authoritativeSourceWindows: new Map([[SOURCE_CALENDAR_ID, WIDE_WINDOW]]),
  authoritativeWindow: WIDE_WINDOW,
  configuredSourceCalendarIds: new Set([SOURCE_CALENDAR_ID]),
  requestedWindow,
  unverifiedMappingIds: new Set<string>(),
  withheldSourceEventStateIds: new Set<string>(),
});

const sourceEvent = (index: number): MaterializedSyncableEvent => ({
  calendarId: SOURCE_CALENDAR_ID,
  calendarName: "Work",
  calendarUrl: null,
  endTime: END_TIME,
  id: `sync-event-${index}`,
  sourceEventUid: `source-uid-${index}`,
  startTime: START_TIME,
  summary: `Standup ${index}`,
});

const frozenMapping = (): EventMapping => ({
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier: "",
  destinationEventUid: "frozen-mirror-uid",
  endTime: END_TIME,
  eventStateId: null,
  id: "mapping-frozen",
  sourceCalendarId: SOURCE_CALENDAR_ID,
  startTime: START_TIME,
  syncEventHash: "hash-at-freeze",
  syncEventId: "sync-event-1",
});

interface ProviderCalls {
  deleted: string[][];
  pushed: MaterializedSyncableEvent[];
  updated: string[];
}

const createRecordingProvider = (
  remoteEvents: RemoteEvent[],
  overrides: Partial<CalendarSyncProvider> = {},
): { calls: ProviderCalls; provider: CalendarSyncProvider } => {
  const calls: ProviderCalls = { deleted: [], pushed: [], updated: [] };
  const provider: CalendarSyncProvider = {
    deleteEvents: (eventIds) => {
      calls.deleted.push(eventIds);
      return Promise.resolve(eventIds.map(() => ({ removedObject: true, success: true })));
    },
    listRemoteEvents: () => Promise.resolve(remoteEvents),
    pushEvents: (events) => {
      calls.pushed.push(...events);
      return Promise.resolve(events.map((event): PushResult => ({
        deleteId: `/calendar/${event.sourceEventUid}.ics`,
        remoteId: `${event.sourceEventUid}@keeper.sh`,
        success: true,
      })));
    },
    updateEvents: (updates) => {
      calls.updated.push(...updates.map((update) => update.deleteId));
      return Promise.resolve(updates.map((update): PushResult => ({
        deleteId: update.deleteId,
        success: true,
      })));
    },
    ...overrides,
  };
  return { calls, provider };
};

interface CycleOutcome {
  result: Awaited<ReturnType<typeof syncCalendar>>;
  wideEvent: Record<string, unknown>;
}

const runCycle = async (
  provider: CalendarSyncProvider,
  state: {
    existingMappings: EventMapping[];
    localEvents: MaterializedSyncableEvent[];
    remoteEvents: RemoteEvent[];
  },
  scope: ReturnType<typeof createScope>,
): Promise<CycleOutcome> => {
  const emitted: Record<string, unknown>[] = [];
  const result = await syncCalendar({
    calendarId: DESTINATION_CALENDAR_ID,
    flush: () => Promise.resolve(),
    isCurrent: () => Promise.resolve(true),
    onSyncEvent: (event) => { emitted.push(event); },
    provider,
    readState: () => Promise.resolve(state),
    reconciliationScope: scope,
    userId: USER_ID,
  });
  const [wideEvent] = emitted;
  if (!wideEvent) {
    throw new TypeError("Expected syncCalendar to emit exactly one wide event");
  }
  return { result, wideEvent };
};

const refusedUpdate = (): PushResult => ({
  destinationAnswer: "answered",
  error: "the recurrence property cannot be cleared on this event",
  errorType: "HttpError",
  requestSent: true,
  statusCode: 400,
  success: false,
});

const namesFrozenMapping = (errors: string[]): boolean =>
  errors.some((error) => error.includes("mapping-frozen"));

describe("one parked event does not back off the whole destination calendar", () => {
  it("does not grade the calendar failed for a frozen mapping whose source was deleted", async () => {
    const mapping = frozenMapping();
    const { calls, provider } = createRecordingProvider([]);
    const scope = createScope(WIDE_WINDOW);
    const state = { existingMappings: [mapping], localEvents: [], remoteEvents: [] };

    const first = await runCycle(provider, state, scope);
    const second = await runCycle(provider, state, scope);

    for (const cycle of [first, second]) {
      expect(cycle.result.removeFailed).toBe(1);
      expect(cycle.result.added).toBe(0);
      expect(cycle.result.updated).toBe(0);
      expect(cycle.result.removed).toBe(0);
      expect(cycle.result.conflictsResolved).toBe(0);

      expect(namesFrozenMapping(cycle.result.errors)).toBe(true);
      expect(cycle.result.errors.some((error) =>
        error.includes("this destination calendar holds no event for it"))).toBe(true);

      const verdict = resolveDestinationAttemptVerdict(
        cycle.result,
        cycle.wideEvent["superseded"] === true,
      );
      expect(verdict).not.toBe("failed");
    }

    expect(calls.deleted).toEqual([]);
    expect(calls.pushed).toEqual([]);
  });

  it("does not grade the calendar failed when the requested window rolled past the frozen mapping", async () => {
    const mapping = frozenMapping();
    const { calls, provider } = createRecordingProvider([]);
    const scope = createScope(ROLLED_PAST_WINDOW);
    const state = {
      existingMappings: [mapping],
      localEvents: [sourceEvent(1)],
      remoteEvents: [],
    };

    const first = await runCycle(provider, state, scope);
    const second = await runCycle(provider, state, scope);

    for (const cycle of [first, second]) {
      expect(cycle.result.removeFailed).toBe(1);
      expect(cycle.result.added).toBe(0);
      expect(cycle.result.updated).toBe(0);
      expect(cycle.result.removed).toBe(0);
      expect(namesFrozenMapping(cycle.result.errors)).toBe(true);

      const verdict = resolveDestinationAttemptVerdict(
        cycle.result,
        cycle.wideEvent["superseded"] === true,
      );
      expect(verdict).not.toBe("failed");
    }

    expect(calls.deleted).toEqual([]);
  });

  it("does not grade a mapping-updates-only cycle failed because a frozen mapping exists", async () => {
    const live = sourceEvent(2);
    const rekeyed: EventMapping = {
      calendarId: DESTINATION_CALENDAR_ID,
      deleteIdentifier: "AAMkAG-old-item-id",
      destinationEventUid: "rekeyed-mirror-uid",
      endTime: END_TIME,
      eventStateId: live.id,
      id: "mapping-rekeyed",
      sourceCalendarId: SOURCE_CALENDAR_ID,
      startTime: START_TIME,
      syncEventHash: createSyncEventContentHash(live),
      syncEventId: live.id,
    };
    const remoteEvents: RemoteEvent[] = [{
      deleteId: "AAMkAG-new-item-id",
      endTime: END_TIME,
      isKeeperEvent: true,
      startTime: START_TIME,
      uid: rekeyed.destinationEventUid,
    }];

    const frozenWithLiveSource: EventMapping = { ...frozenMapping(), eventStateId: "sync-event-1" };

    const { calls, provider } = createRecordingProvider(remoteEvents);
    const cycle = await runCycle(
      provider,
      {
        existingMappings: [frozenWithLiveSource, rekeyed],
        localEvents: [sourceEvent(1), live],
        remoteEvents,
      },
      createScope(WIDE_WINDOW),
    );

    expect(cycle.wideEvent["operations.total"]).toBe(0);
    expect(cycle.wideEvent["mapping_updates.count"]).toBe(1);
    expect(cycle.wideEvent["outcome"]).toBe("success");

    expect(cycle.result.added).toBe(0);
    expect(cycle.result.updated).toBe(0);
    expect(cycle.result.removed).toBe(0);
    expect(cycle.result.removeFailed).toBe(0);

    expect(cycle.result.errors.some((error) =>
      error.includes("this destination calendar holds no event for mapping mapping-frozen"))).toBe(true);

    expect(resolveDestinationAttemptVerdict(cycle.result, false)).not.toBe("failed");

    expect(resolveDestinationAttemptVerdict(cycle.result, true)).toBe("inconclusive");

    expect(calls.deleted).toEqual([]);
    expect(calls.pushed).toEqual([]);
  });

  it("does not grade the calendar failed for an escaped permanently-refused update", async () => {
    const edited: MaterializedSyncableEvent = {
      ...sourceEvent(3),
      summary: "Standup 3 — moved to Thursday",
    };
    const mirrorDeleteId = "AAMkAG-mirror-still-there";
    const mirrorUid = "mirror-uid-3";

    for (const consecutiveUpdateFailures of [0, 1, 2]) {
      const mapping: EventMapping = {
        calendarId: DESTINATION_CALENDAR_ID,
        consecutiveUpdateFailures,
        deleteIdentifier: mirrorDeleteId,
        destinationEventUid: mirrorUid,
        endTime: END_TIME,
        eventStateId: edited.id,
        id: "mapping-refused",
        sourceCalendarId: SOURCE_CALENDAR_ID,
        startTime: START_TIME,
        syncEventHash: "hash-before-the-edit",
        syncEventId: edited.id,
      };
      const replacement: Extract<SyncOperation, { type: "replace" }> = {
        deleteId: mapping.deleteIdentifier,
        event: edited,
        staleMappingId: mapping.id,
        type: "replace",
        uid: mapping.destinationEventUid,
      };

      const { calls, provider } = createRecordingProvider([], {
        updateEvents: () => Promise.resolve([refusedUpdate()]),
        verifyEventsExist: (targets) => Promise.resolve(targets.map((target): EventPresence => ({
          event: {
            deleteId: target.deleteId,
            endTime: END_TIME,
            isKeeperEvent: true,
            startTime: START_TIME,
            uid: mirrorUid,
          },
          identifier: target.deleteId,
          status: "present",
        }))),
      });

      const outcome = await executeRemoteOperations(
        [replacement],
        [mapping],
        DESTINATION_CALENDAR_ID,
        provider,
      );

      const result = { ...outcome.result, conflictsResolved: outcome.conflictsResolved };

      expect(result.added).toBe(0);
      expect(result.updated).toBe(0);
      expect(result.removed).toBe(0);
      expect(result.removeFailed).toBe(0);
      expect(result.addFailed).toBeGreaterThan(0);

      expect(outcome.errors.some((entry) =>
        entry.error.includes("mapping-refused")
        && entry.error.includes("the recurrence property cannot be cleared on this event"))).toBe(true);

      expect(result.parked ?? 0).toBeGreaterThan(0);
      expect(resolveDestinationAttemptVerdict(result, false)).not.toBe("failed");

      expect(calls.deleted).toEqual([]);
      expect(calls.pushed).toEqual([]);
    }
  });

  it("still grades an ordinary destination 500 as failed", async () => {
    const event = sourceEvent(4);
    const { provider } = createRecordingProvider([], {
      pushEvents: () => Promise.resolve([{
        error: "Internal Server Error",
        errorType: "HttpError",
        requestSent: true,
        statusCode: 500,
        success: false,
      }]),
    });

    const cycle = await runCycle(
      provider,
      { existingMappings: [], localEvents: [event], remoteEvents: [] },
      createScope(WIDE_WINDOW),
    );

    expect(cycle.result.added).toBe(0);
    expect(cycle.result.addFailed).toBe(1);

    expect(resolveDestinationAttemptVerdict(cycle.result, false)).toBe("failed");
  });
});
