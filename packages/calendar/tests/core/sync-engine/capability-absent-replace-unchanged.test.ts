import { describe, expect, it } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import type { CalendarSyncProvider, PendingChanges } from "../../../src/core/sync-engine/types";
import type { DeleteResult, MaterializedSyncableEvent, PushResult, SyncOperation } from "../../../src/core/types";
import type { EventMapping } from "../../../src/core/events/mappings";

const makeEvent = (id: string): MaterializedSyncableEvent => ({
  id,
  sourceEventUid: `uid-${id}`,
  startTime: new Date("2026-04-02T11:00:00Z"),
  endTime: new Date("2026-04-02T12:00:00Z"),
  summary: `Event ${id}`,
  calendarId: "cal-src",
  calendarName: "Source Calendar",
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
  calendarId: "dest-shared",
  sourceCalendarId: "cal-src",
  destinationEventUid: `remote-${index}@keeper.sh`,
  deleteIdentifier: `remote-${index}@keeper.sh`,
  syncEventHash: "stale-hash",
  startTime: new Date("2026-04-02T11:00:00Z"),
  endTime: new Date("2026-04-02T12:00:00Z"),
});

const makeReplacement = (index: number): Extract<SyncOperation, { type: "replace" }> => ({
  type: "replace",
  event: makeEvent(`ev-${index}`),
  staleMappingId: `map-${index}`,
  uid: `remote-${index}@keeper.sh`,
  deleteId: `remote-${index}@keeper.sh`,
});

const createProviderWithoutUpdate = (deleteResults: DeleteResult[]): {
  calls: string[];
  provider: CalendarSyncProvider;
} => {
  const calls: string[] = [];

  const provider: CalendarSyncProvider = {
    deleteEvents: (eventIds) => {
      calls.push(`delete:${eventIds.join(",")}`);
      return Promise.resolve(deleteResults.slice(0, eventIds.length));
    },
    listRemoteEvents: () => Promise.resolve([]),
    pushEvents: (events) => {
      calls.push(`push:${events.map((event) => event.id).join(",")}`);
      return Promise.resolve(events.map((event): PushResult => ({
        success: true,
        remoteId: `${event.sourceEventUid}@keeper.sh`,
        deleteId: `${event.sourceEventUid}@keeper.sh`,
      })));
    },
  };

  return { calls, provider };
};

describe("a destination without the update capability", () => {
  it("still replaces by deleting then adding, recording no in-place update", async () => {
    const replacements = [makeReplacement(1), makeReplacement(2)];
    const mappings = [makeMapping(1), makeMapping(2)];
    const { calls, provider } = createProviderWithoutUpdate([{ success: true }, { success: true }]);
    const checkpoints: PendingChanges[] = [];
    const progress: number[][] = [];

    const outcome = await executeRemoteOperations(
      replacements,
      mappings,
      "dest-shared",
      provider,
      () => Promise.resolve(true),
      (processed, total) => progress.push([processed, total]),
      (changes) => {
        checkpoints.push(changes);
        return Promise.resolve(true);
      },
    );

    expect(provider.updateEvents).toBeUndefined();
    expect(calls).toEqual([
      "delete:remote-1@keeper.sh,remote-2@keeper.sh",
      "push:ev-1,ev-2",
    ]);
    expect(outcome.result).toEqual({ added: 2, addFailed: 0, removed: 2, removeFailed: 0 });
    expect(outcome.updateFallbacks).toBe(0);
    expect(outcome.changes.updates ?? []).toEqual([]);
    expect(outcome.changes.deletes).toEqual(["map-1", "map-2"]);
    expect(outcome.changes.inserts).toHaveLength(2);
    expect(outcome.errors).toEqual([]);
    expect(progress).toEqual([[4, 4]]);
    for (const changes of checkpoints) {
      expect(changes.updates ?? []).toEqual([]);
    }
  });

  it("leaves the mapping intact when the delete fails, so no orphan add is written", async () => {
    const replacements = [makeReplacement(1)];
    const mappings = [makeMapping(1)];
    const { calls, provider } = createProviderWithoutUpdate([
      { success: false, error: "service unavailable", errorType: "server_error", statusCode: 503 },
    ]);

    const outcome = await executeRemoteOperations(replacements, mappings, "dest-shared", provider);

    expect(calls).toEqual(["delete:remote-1@keeper.sh"]);
    expect(outcome.result).toEqual({ added: 0, addFailed: 0, removed: 0, removeFailed: 1 });
    expect(outcome.updateFallbacks).toBe(0);
    expect(outcome.changes.deletes).toEqual([]);
    expect(outcome.changes.inserts).toEqual([]);
    expect(outcome.changes.updates ?? []).toEqual([]);
    expect(outcome.errors).toEqual([
      { type: "remove", error: "service unavailable", errorType: "server_error", statusCode: 503 },
    ]);
  });
});

describe("a capability-less destination across chunk boundaries", () => {
  it("keeps the delete-then-add pairing within each chunk", async () => {
    const count = 51;
    const replacements = Array.from({ length: count }, (item, index) => makeReplacement(index + 1));
    const mappings = Array.from({ length: count }, (item, index) => makeMapping(index + 1));
    const { calls, provider } = createProviderWithoutUpdate(
      Array.from({ length: count }, (): DeleteResult => ({ success: true })),
    );

    const outcome = await executeRemoteOperations(replacements, mappings, "dest-shared", provider);

    const batchSizes = calls.map((call) => call.split(":")[1]?.split(",").length ?? 0);
    expect(calls.map((call) => call.split(":")[0])).toEqual(["delete", "push", "delete", "push"]);
    expect(batchSizes).toEqual([50, 50, 1, 1]);
    expect(outcome.result).toEqual({ added: count, addFailed: 0, removed: count, removeFailed: 0 });
    expect(outcome.updateFallbacks).toBe(0);
    expect(outcome.changes.updates ?? []).toEqual([]);
    expect(outcome.changes.deletes).toHaveLength(count);
  });
});
