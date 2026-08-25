import { describe, expect, it } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import type { CalendarSyncProvider } from "../../../src/core/sync-engine/types";
import type { DeleteResult, MaterializedSyncableEvent, PushResult, SyncOperation } from "../../../src/core/types";
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
  remoteAvailability: null,
  remoteContentHash: null,
  remoteEndTime: null,
  remoteStartTime: null,
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

const createUpdateCapableProvider = (
  updateResults: PushResult[],
  /* Every real destination reports removedObject only when an object actually left it: a bare
     success is what Outlook and CalDAV answer for a 404, which removes nothing. */
  deleteResults: DeleteResult[] = [{ removedObject: true, success: true }, { removedObject: true, success: true }],
) => {
  const deleteCalls: string[][] = [];
  const pushCalls: MaterializedSyncableEvent[][] = [];
  const updateCalls: { deleteId: string; event: MaterializedSyncableEvent }[][] = [];

  const provider: CalendarSyncProvider = {
    deleteEvents: (eventIds) => {
      deleteCalls.push(eventIds);
      return Promise.resolve(deleteResults.slice(0, eventIds.length));
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
    updateEvents: (updates) => {
      updateCalls.push(updates);
      return Promise.resolve(updateResults.slice(0, updates.length));
    },
  };

  return { deleteCalls, provider, pushCalls, updateCalls };
};

describe("a failed in-place update", () => {
  it("falls back to delete-then-add for only the failed operation", async () => {
    const replacements = [makeReplacement(1), makeReplacement(2)];
    const mappings = [makeMapping(1), makeMapping(2)];
    const { deleteCalls, provider, pushCalls, updateCalls } = createUpdateCapableProvider([
      { success: true, remoteId: "remote-1@keeper.sh", deleteId: "/calendar/remote-1@keeper.sh.ics" },
      { success: false, error: "gone", errorType: "server_error", statusCode: 404 },
    ]);

    const outcome = await executeRemoteOperations(
      replacements,
      mappings,
      "dest-cal-1",
      provider,
    );

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toHaveLength(2);

    expect(deleteCalls).toEqual([["/calendar/remote-2@keeper.sh.ics"]]);
    expect(pushCalls).toEqual([[replacements[1]?.event]]);

    expect(outcome.changes.updates).toHaveLength(1);
    expect(outcome.changes.updates?.[0]).toMatchObject({
      id: "map-1",
      syncEventId: "ev-1",
    });

    expect(outcome.changes.deletes).toEqual(["map-2"]);
    expect(outcome.changes.inserts).toHaveLength(1);
    expect(outcome.changes.inserts[0]).toMatchObject({
      destinationEventUid: "uid-ev-2@keeper.sh",
      syncEventId: "ev-2",
    });
  });

  it("does not re-add a fallback whose delete also failed", async () => {
    const replacements = [makeReplacement(1)];
    const mappings = [makeMapping(1)];
    const { deleteCalls, provider, pushCalls } = createUpdateCapableProvider(
      [{ success: false, error: "gone", errorType: "server_error", statusCode: 404 }],
      [{ success: false, error: "boom", errorType: "server_error", statusCode: 500 }],
    );

    const outcome = await executeRemoteOperations(replacements, mappings, "dest-cal-1", provider);

    expect(deleteCalls).toEqual([["/calendar/remote-1@keeper.sh.ics"]]);
    expect(pushCalls).toEqual([]);
    expect(outcome.changes.inserts).toEqual([]);
    expect(outcome.changes.deletes).toEqual([]);
    expect(outcome.result.removeFailed).toBe(1);
  });

  it("leaves a fully successful update batch untouched by the fallback", async () => {
    const replacements = [makeReplacement(1), makeReplacement(2)];
    const mappings = [makeMapping(1), makeMapping(2)];
    const { deleteCalls, provider, pushCalls } = createUpdateCapableProvider([
      { success: true, remoteId: "remote-1@keeper.sh", deleteId: "/calendar/remote-1@keeper.sh.ics" },
      { success: true, remoteId: "remote-2@keeper.sh", deleteId: "/calendar/remote-2@keeper.sh.ics" },
    ]);

    const outcome = await executeRemoteOperations(replacements, mappings, "dest-cal-1", provider);

    expect(deleteCalls).toEqual([]);
    expect(pushCalls).toEqual([]);
    expect(outcome.changes.updates).toHaveLength(2);
    expect(outcome.changes.deletes).toEqual([]);
    expect(outcome.changes.inserts).toEqual([]);
  });
});
