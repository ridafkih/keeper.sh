import { describe, expect, it } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import type { CalendarSyncProvider, EventUpdate } from "../../../src/core/sync-engine/types";
import type { MaterializedSyncableEvent, PushResult, SyncOperation } from "../../../src/core/types";
import type { EventMapping } from "../../../src/core/events/mappings";

const EVENT_INDEXES = [1, 2, 3];
const FAILING_INDEX = 2;

const makeEvent = (index: number): MaterializedSyncableEvent => ({
  id: `ev-${index}`,
  sourceEventUid: `uid-ev-${index}`,
  startTime: new Date("2026-03-15T09:00:00Z"),
  endTime: new Date("2026-03-15T10:00:00Z"),
  summary: `Event ${index} renamed`,
  calendarId: "cal-1",
  calendarName: "Test Calendar",
  calendarUrl: null,
});

const makeMapping = (index: number): EventMapping => ({
  remoteAvailability: null,
  remoteContentHash: null,
  remoteEndTime: null,
  remoteStartTime: null,
  id: `map-${index}`,
  eventStateId: `ev-${index}`,
  syncEventId: `ev-${index}`,
  calendarId: "dest-cal-1",
  sourceCalendarId: "cal-1",
  destinationEventUid: `remote-${index}@keeper.sh`,
  deleteIdentifier: `/calendar/remote-${index}@keeper.sh.ics`,
  syncEventHash: "diverged-remote-hash",
  startTime: new Date("2026-03-15T09:00:00Z"),
  endTime: new Date("2026-03-15T10:00:00Z"),
});

const makeReplacement = (index: number): Extract<SyncOperation, { type: "replace" }> => ({
  type: "replace",
  event: makeEvent(index),
  staleMappingId: `map-${index}`,
  uid: `remote-${index}@keeper.sh`,
  deleteId: `/calendar/remote-${index}@keeper.sh.ics`,
});

const createProvider = (updateOutcome: (update: EventUpdate) => PushResult) => {
  const deletedIds: string[][] = [];
  const pushedEvents: MaterializedSyncableEvent[][] = [];

  const provider: CalendarSyncProvider = {
    deleteEvents: (eventIds) => {
      deletedIds.push(eventIds);
      return Promise.resolve(eventIds.map(() => ({ success: true })));
    },
    listRemoteEvents: () => Promise.resolve([]),
    pushEvents: (events) => {
      pushedEvents.push(events);
      return Promise.resolve(events.map((event): PushResult => ({
        success: true,
        remoteId: `${event.sourceEventUid}@keeper.sh`,
        deleteId: `/calendar/${event.sourceEventUid}@keeper.sh.ics`,
      })));
    },
    updateEvents: (updates) => Promise.resolve(updates.map((update) => updateOutcome(update))),
  };

  return { deletedIds, provider, pushedEvents };
};

const failsOnlyTheSecondEvent = (message?: string) => (update: EventUpdate): PushResult => {
  if (update.event.id !== `ev-${FAILING_INDEX}`) {
    return { success: true, deleteId: update.deleteId, remoteId: update.event.id };
  }
  return {
    success: false,
    errorType: "GoogleApiError",
    statusCode: 500,
    ...(message && { error: message }),
  };
};

const runReplacements = async (updateOutcome: (update: EventUpdate) => PushResult) => {
  const replacements = EVENT_INDEXES.map((index) => makeReplacement(index));
  const mappings = EVENT_INDEXES.map((index) => makeMapping(index));
  const { deletedIds, provider, pushedEvents } = createProvider(updateOutcome);
  const outcome = await executeRemoteOperations(replacements, mappings, "dest-cal-1", provider);
  return { deletedIds, outcome, pushedEvents };
};

describe("a failure is counted once", () => {
  it("counts and reports a single failed update exactly once", async () => {
    const { deletedIds, outcome, pushedEvents } = await runReplacements(failsOnlyTheSecondEvent("internal error"));

    expect(outcome.result.addFailed).toBe(1);
    expect(outcome.result.added).toBe(EVENT_INDEXES.length - 1);
    expect(outcome.result.removeFailed).toBe(0);
    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0]?.type).toBe("update");
    expect(outcome.errors[0]?.statusCode).toBe(500);
    expect(outcome.updateFallbacks).toBe(0);
    expect(deletedIds).toEqual([]);
    expect(pushedEvents).toEqual([]);
  });

  it("still reports a failed update that carried no message exactly once", async () => {
    const { deletedIds, outcome, pushedEvents } = await runReplacements(failsOnlyTheSecondEvent());

    expect(outcome.result.addFailed).toBe(1);
    expect(outcome.result.added).toBe(EVENT_INDEXES.length - 1);
    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0]?.type).toBe("update");
    expect(outcome.errors[0]?.statusCode).toBe(500);
    expect(outcome.errors[0]?.error).toBeTruthy();
    expect(outcome.updateFallbacks).toBe(0);
    expect(deletedIds).toEqual([]);
    expect(pushedEvents).toEqual([]);
  });
});
