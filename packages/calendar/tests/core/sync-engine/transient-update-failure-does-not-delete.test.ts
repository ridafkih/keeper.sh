import { describe, expect, it } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import type { CalendarSyncProvider } from "../../../src/core/sync-engine/types";
import type { MaterializedSyncableEvent, PushResult, SyncOperation } from "../../../src/core/types";
import type { EventMapping } from "../../../src/core/events/mappings";

const makeEvent = (id: string): MaterializedSyncableEvent => ({
  id,
  sourceEventUid: `uid-${id}`,
  startTime: new Date("2026-03-15T09:00:00Z"),
  endTime: new Date("2026-03-15T10:00:00Z"),
  summary: `Event ${id}`,
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
  syncEventHash: "stale-hash",
  startTime: new Date("2026-03-15T09:00:00Z"),
  endTime: new Date("2026-03-15T10:00:00Z"),
});

const makeReplacement = (index: number): Extract<SyncOperation, { type: "replace" }> => ({
  type: "replace",
  event: makeEvent(`ev-${index}`),
  staleMappingId: `map-${index}`,
  uid: `remote-${index}@keeper.sh`,
  deleteId: `/calendar/remote-${index}@keeper.sh.ics`,
});

const createProvider = (updateResults: PushResult[]) => {
  const deleteCalls: string[][] = [];
  const pushCalls: MaterializedSyncableEvent[][] = [];

  const provider: CalendarSyncProvider = {
    deleteEvents: (eventIds) => {
      deleteCalls.push(eventIds);
      return Promise.resolve(eventIds.map(() => ({ success: true })));
    },
    listRemoteEvents: () => Promise.resolve([]),
    pushEvents: (events) => {
      pushCalls.push(events);
      return Promise.resolve(events.map((event): PushResult => ({
        success: true,
        remoteId: `${event.sourceEventUid}@keeper.sh`,
        deleteId: `/calendar/${event.sourceEventUid}@keeper.sh.ics`,
      })));
    },
    updateEvents: (updates) => Promise.resolve(updateResults.slice(0, updates.length)),
  };

  return { deleteCalls, provider, pushCalls };
};

const transientFailures: { label: string; result: PushResult }[] = [
  {
    label: "a server error",
    result: { success: false, error: "service unavailable", errorType: "CalDAVHttpError", statusCode: 503 },
  },
  {
    label: "a throttle",
    result: { success: false, error: "too many requests", errorType: "CalDAVHttpError", statusCode: 429 },
  },
  {
    label: "a dropped connection",
    result: { success: false, error: "socket hang up", errorType: "TypeError" },
  },
];

describe("a transient update failure does not delete the event", () => {
  for (const failure of transientFailures) {
    it(`leaves the event alone and reports the error after ${failure.label}`, async () => {
      const replacements = [makeReplacement(1)];
      const mappings = [makeMapping(1)];
      const { deleteCalls, provider, pushCalls } = createProvider([failure.result]);

      const outcome = await executeRemoteOperations(replacements, mappings, "dest-cal-1", provider);

      expect(deleteCalls).toEqual([]);
      expect(pushCalls).toEqual([]);
      expect(outcome.changes.deletes).toEqual([]);
      expect(outcome.changes.inserts).toEqual([]);
      expect(outcome.changes.updates ?? []).toEqual([]);
      expect(outcome.result.removed).toBe(0);
      expect(outcome.errors).toEqual([
        expect.objectContaining({ type: "update", error: failure.result.error }),
      ]);
    });
  }

  it("still falls back to creating the event when the target is gone", async () => {
    const replacements = [makeReplacement(2)];
    const mappings = [makeMapping(2)];
    const { deleteCalls, provider, pushCalls } = createProvider([
      { success: false, error: "not found", errorType: "CalDAVHttpError", statusCode: 404 },
    ]);

    const outcome = await executeRemoteOperations(replacements, mappings, "dest-cal-1", provider);

    expect(deleteCalls).toEqual([["/calendar/remote-2@keeper.sh.ics"]]);
    expect(pushCalls).toEqual([[replacements[0]?.event]]);
    expect(outcome.changes.inserts).toHaveLength(1);
    expect(outcome.changes.deletes).toEqual(["map-2"]);
  });
});
