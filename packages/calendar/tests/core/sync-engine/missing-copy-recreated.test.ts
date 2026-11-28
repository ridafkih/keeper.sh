import { describe, expect, it } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import { computeSyncOperations } from "../../../src/core/sync/operations";
import { createSyncEventContentHash } from "../../../src/core/events/content-hash";
import type { CalendarSyncProvider } from "../../../src/core/sync-engine/types";
import type { MaterializedSyncableEvent, PushResult } from "../../../src/core/types";
import type { EventMapping } from "../../../src/core/events/mappings";

const WINDOW = {
  timeMax: new Date("2100-01-01T00:00:00.000Z"),
  timeMin: new Date("2000-01-01T00:00:00.000Z"),
};

const event: MaterializedSyncableEvent = {
  calendarId: "source-1",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2026-03-15T10:00:00Z"),
  id: "event-1",
  sourceEventUid: "uid-event-1",
  startTime: new Date("2026-03-15T09:00:00Z"),
  summary: "Standup",
};

const mapping: EventMapping = {
  calendarId: "destination-1",
  deleteIdentifier: "google-event-1",
  destinationEventUid: "copy-1@keeper.sh",
  endTime: event.endTime,
  eventStateId: "event-1",
  id: "mapping-1",
  sourceCalendarId: "source-1",
  startTime: event.startTime,
  syncEventHash: createSyncEventContentHash(event),
  syncEventId: "event-1",
};

describe("a mapping whose destination copy is missing from the listing", () => {
  it("re-creates the copy without first deleting it and swaps the mapping", async () => {
    const deleteCalls: string[][] = [];
    const pushCalls: MaterializedSyncableEvent[][] = [];
    const provider: CalendarSyncProvider = {
      deleteEvents: (ids) => {
        deleteCalls.push(ids);
        return Promise.resolve(ids.map(() => ({ error: "Conflict", statusCode: 409, success: false })));
      },
      listRemoteEvents: () => Promise.resolve([]),
      pushEvents: (events) => {
        pushCalls.push(events);
        return Promise.resolve(events.map((): PushResult => ({
          deleteId: "google-event-1-restored",
          remoteId: "copy-1@keeper.sh",
          success: true,
        })));
      },
    };

    const { operations, staleReasonCounts } = computeSyncOperations(
      [event],
      [mapping],
      [],
      { authoritativeWindow: WINDOW, requestedWindow: WINDOW },
    );
    const outcome = await executeRemoteOperations(operations, [mapping], "destination-1", provider);

    expect(staleReasonCounts.remoteMissing).toBe(1);
    expect(deleteCalls).toEqual([]);
    expect(pushCalls).toEqual([[event]]);
    expect(outcome.result).toEqual({ added: 1, addFailed: 0, removed: 0, removeFailed: 0 });
    expect(outcome.changes.deletes).toEqual(["mapping-1"]);
    expect(outcome.changes.inserts).toEqual([expect.objectContaining({
      deleteIdentifier: "google-event-1-restored",
      destinationEventUid: "copy-1@keeper.sh",
      syncEventId: "event-1",
    })]);
  });
});
