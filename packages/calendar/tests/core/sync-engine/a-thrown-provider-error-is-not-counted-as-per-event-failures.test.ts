import { describe, expect, it } from "vitest";
import { executeRemoteOperations, syncCalendar } from "../../../src/core/sync-engine/index";
import type { CalendarSyncProvider, EventUpdate } from "../../../src/core/sync-engine/types";
import type { MaterializedSyncableEvent, PushResult, SyncOperation } from "../../../src/core/types";
import type { EventMapping } from "../../../src/core/events/mappings";

const TEST_RECONCILIATION_SCOPE = {
  authoritativeWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
  requestedWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
};

const EVENT_INDEXES = [1, 2, 3];

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

const makeRemoteEvent = (mapping: EventMapping) => ({
  deleteId: mapping.deleteIdentifier,
  endTime: mapping.endTime,
  isKeeperEvent: true,
  startTime: mapping.startTime,
  uid: mapping.destinationEventUid,
});

const makeReplacement = (index: number): Extract<SyncOperation, { type: "replace" }> => ({
  type: "replace",
  event: makeEvent(index),
  staleMappingId: `map-${index}`,
  uid: `remote-${index}@keeper.sh`,
  deleteId: `/calendar/remote-${index}@keeper.sh.ics`,
});

const makeDeadlineError = (): Error => {
  const deadlineError = new Error("job deadline exceeded");
  deadlineError.name = "AbortError";
  return deadlineError;
};

const REJECTED_UPDATE: PushResult = {
  success: false,
  error: "internal error",
  errorType: "OutlookApiError",
  statusCode: 500,
};

const createProvider = (updateEvents: CalendarSyncProvider["updateEvents"]) => {
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
    updateEvents,
  };

  return { deletedIds, provider, pushedEvents };
};

const rejectEveryUpdate = (updates: EventUpdate[]): Promise<PushResult[]> =>
  Promise.resolve(updates.map((): PushResult => REJECTED_UPDATE));

const runSyncCalendar = async (
  provider: CalendarSyncProvider,
  mappings: EventMapping[],
): Promise<{ emitted: Record<string, unknown>[]; thrown: unknown }> => {
  const emitted: Record<string, unknown>[] = [];
  let thrown: unknown = null;
  try {
    await syncCalendar({
      calendarId: "dest-cal-1",
      flush: () => Promise.resolve(),
      isCurrent: () => Promise.resolve(true),
      onSyncEvent: (event) => { emitted.push(event); },
      provider,
      readState: () => Promise.resolve({
        existingMappings: mappings,
        localEvents: EVENT_INDEXES.map((index) => makeEvent(index)),
        remoteEvents: mappings.map((mapping) => makeRemoteEvent(mapping)),
      }),
      reconciliationScope: TEST_RECONCILIATION_SCOPE,
      userId: "user-1",
    });
  } catch (error) {
    thrown = error;
  }
  return { emitted, thrown };
};

describe("a thrown provider error is not counted as per-event failures", () => {
  it("propagates a thrown update error instead of resolving with per-event failures", async () => {
    const deadlineError = makeDeadlineError();
    const replacements = EVENT_INDEXES.map((index) => makeReplacement(index));
    const mappings = EVENT_INDEXES.map((index) => makeMapping(index));
    const { deletedIds, provider, pushedEvents } = createProvider(() => Promise.reject(deadlineError));

    await expect(executeRemoteOperations(replacements, mappings, "dest-cal-1", provider)).rejects.toBe(deadlineError);

    expect(deletedIds).toEqual([]);
    expect(pushedEvents).toEqual([]);
  });

  it("reports the run as failed without attributing a failure to each event", async () => {
    const deadlineError = makeDeadlineError();
    const mappings = EVENT_INDEXES.map((index) => makeMapping(index));
    const { provider } = createProvider(() => Promise.reject(deadlineError));

    const { emitted, thrown } = await runSyncCalendar(provider, mappings);

    expect(thrown).toBe(deadlineError);
    expect(emitted).toHaveLength(1);
    const wideEvent = emitted[0] as Record<string, unknown>;
    expect(wideEvent["outcome"]).toBe("error");
    expect(wideEvent["error.type"]).toBe("Error");
    expect(wideEvent["error.message"]).toBe("job deadline exceeded");
    expect(wideEvent["events.add_failed"]).toBeUndefined();
    expect(wideEvent["operation_errors.count"]).toBeUndefined();
  });

  it("still counts each per-result update failure exactly once", async () => {
    const replacements = EVENT_INDEXES.map((index) => makeReplacement(index));
    const mappings = EVENT_INDEXES.map((index) => makeMapping(index));
    const { deletedIds, provider, pushedEvents } = createProvider(rejectEveryUpdate);

    const outcome = await executeRemoteOperations(replacements, mappings, "dest-cal-1", provider);

    expect(outcome.result.added).toBe(0);
    expect(outcome.result.addFailed).toBe(EVENT_INDEXES.length);
    expect(outcome.errors).toHaveLength(EVENT_INDEXES.length);
    expect(outcome.errors.every((operationError) => operationError.type === "update")).toBe(true);
    expect(deletedIds).toEqual([]);
    expect(pushedEvents).toEqual([]);
  });
});
