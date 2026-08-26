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

const createLegacyProvider = (deleteResults: DeleteResult[]) => {
  const deleteCalls: string[][] = [];
  const pushCalls: MaterializedSyncableEvent[][] = [];

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
  };

  return { deleteCalls, provider, pushCalls };
};

describe("executeReplacements without an update-capable provider", () => {
  it("deletes then re-adds every replacement", async () => {
    const replacements = [makeReplacement(1), makeReplacement(2)];
    const mappings = [makeMapping(1), makeMapping(2)];
    const { deleteCalls, provider, pushCalls } = createLegacyProvider([
      { success: true },
      { success: true },
    ]);
    const progress: number[][] = [];

    const outcome = await executeRemoteOperations(
      replacements,
      mappings,
      "dest-cal-1",
      provider,
      () => Promise.resolve(true),
      (processed, total) => progress.push([processed, total]),
    );

    expect(provider.updateEvents).toBeUndefined();
    expect(deleteCalls).toEqual([[
      "/calendar/remote-1@keeper.sh.ics",
      "/calendar/remote-2@keeper.sh.ics",
    ]]);
    expect(pushCalls).toEqual([[replacements[0]?.event, replacements[1]?.event]]);
    expect(outcome.result).toEqual({ added: 2, addFailed: 0, updated: 0, removed: 2, removeFailed: 0 });
    expect(outcome.changes.deletes).toEqual(["map-1", "map-2"]);
    expect(outcome.changes.inserts).toHaveLength(2);
    expect(outcome.changes.inserts[0]).toMatchObject({
      calendarId: "dest-cal-1",
      destinationEventUid: "uid-ev-1@keeper.sh",
      deleteIdentifier: "/calendar/uid-ev-1@keeper.sh.ics",
      eventStateId: "ev-1",
      syncEventId: "ev-1",
      sourceCalendarId: "cal-1",
    });
    expect(outcome.errors).toEqual([]);
    expect(progress).toEqual([[4, 4]]);
  });

  it("skips the re-add for a replacement whose delete failed", async () => {
    const replacements = [makeReplacement(1), makeReplacement(2)];
    const mappings = [makeMapping(1), makeMapping(2)];
    const { deleteCalls, provider, pushCalls } = createLegacyProvider([
      { success: false, error: "boom", errorType: "server_error", statusCode: 500 },
      { success: true },
    ]);

    const outcome = await executeRemoteOperations(replacements, mappings, "dest-cal-1", provider);

    expect(deleteCalls).toHaveLength(1);
    expect(pushCalls).toEqual([[replacements[1]?.event]]);
    expect(outcome.result).toEqual({ added: 1, addFailed: 0, updated: 0, removed: 1, removeFailed: 1 });
    expect(outcome.changes.deletes).toEqual(["map-2"]);
    expect(outcome.changes.inserts).toHaveLength(1);
    expect(outcome.errors).toEqual([
      { type: "remove", error: "boom", errorType: "server_error", statusCode: 500 },
    ]);
  });
});
