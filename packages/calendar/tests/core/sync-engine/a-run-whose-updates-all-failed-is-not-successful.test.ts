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

const REJECTED_UPDATE: PushResult = {
  success: false,
  error: "service unavailable",
  errorType: "CalDAVHttpError",
  statusCode: 503,
};

const createProvider = (updateOutcome: (update: EventUpdate) => PushResult) => {
  const deletedIds: string[][] = [];
  const pushedEvents: MaterializedSyncableEvent[][] = [];
  const updatedBatches: EventUpdate[][] = [];

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
    updateEvents: (updates) => {
      updatedBatches.push(updates);
      return Promise.resolve(updates.map((update) => updateOutcome(update)));
    },
  };

  return { deletedIds, provider, pushedEvents, updatedBatches };
};

const uidHeldByMapping = (deleteId: string): string =>
  deleteId.replace("/calendar/", "").replace(".ics", "");

const acceptUpdate = (update: EventUpdate): PushResult => ({
  success: true,
  deleteId: update.deleteId,
  remoteId: uidHeldByMapping(update.deleteId),
});

const rejectUpdate = (): PushResult => REJECTED_UPDATE;

const runSyncCalendar = async (
  provider: CalendarSyncProvider,
  mappings: EventMapping[],
): Promise<Record<string, unknown>> => {
  const emitted: Record<string, unknown>[] = [];
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
  expect(emitted).toHaveLength(1);
  return emitted[0] as Record<string, unknown>;
};

describe("a run whose updates all failed is not successful", () => {
  it("counts every rejected in-place update as a failure", async () => {
    const replacements = EVENT_INDEXES.map((index) => makeReplacement(index));
    const mappings = EVENT_INDEXES.map((index) => makeMapping(index));
    const { deletedIds, provider, pushedEvents } = createProvider(rejectUpdate);

    const outcome = await executeRemoteOperations(replacements, mappings, "dest-cal-1", provider);

    expect(outcome.result.added).toBe(0);
    expect(outcome.result.addFailed).toBe(EVENT_INDEXES.length);
    expect(outcome.result.removed).toBe(0);
    expect(outcome.result.removeFailed).toBe(0);
    expect(outcome.errors).toHaveLength(EVENT_INDEXES.length);
    expect(deletedIds).toEqual([]);
    expect(pushedEvents).toEqual([]);
  });

  it("reports the failures once in the wide event of a run that wrote nothing", async () => {
    const mappings = EVENT_INDEXES.map((index) => makeMapping(index));
    const { provider, updatedBatches } = createProvider(rejectUpdate);

    const wideEvent = await runSyncCalendar(provider, mappings);

    expect(updatedBatches.flat()).toHaveLength(EVENT_INDEXES.length);
    expect(wideEvent["events.added"]).toBe(0);
    expect(wideEvent["events.removed"]).toBe(0);
    expect(wideEvent["events.remove_failed"]).toBe(0);
    expect(wideEvent["events.add_failed"]).toBe(EVENT_INDEXES.length);
    expect(wideEvent["operation_errors.count"]).toBe(EVENT_INDEXES.length);
  });

  it("still reports a run whose updates all succeeded as a clean success", async () => {
    const mappings = EVENT_INDEXES.map((index) => makeMapping(index));
    const { deletedIds, provider, pushedEvents } = createProvider(acceptUpdate);

    const wideEvent = await runSyncCalendar(provider, mappings);

    expect(wideEvent["outcome"]).toBe("success");
    expect(wideEvent["events.added"]).toBe(0);
    expect(wideEvent["events.updated"]).toBe(EVENT_INDEXES.length);
    expect(wideEvent["events.add_failed"]).toBe(0);
    expect(wideEvent["events.remove_failed"]).toBe(0);
    expect(wideEvent["operation_errors.count"]).toBeUndefined();
    expect(deletedIds).toEqual([]);
    expect(pushedEvents).toEqual([]);
  });
});
