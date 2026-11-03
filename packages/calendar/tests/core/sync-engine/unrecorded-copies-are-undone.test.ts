import { describe, expect, it } from "vitest";
import { syncCalendar } from "../../../src/core/sync-engine/index";
import type { MaterializedSyncableEvent } from "../../../src/core/types";

const SCOPE = {
  authoritativeWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
  requestedWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
};

const makeEvent = (id: string): MaterializedSyncableEvent => ({
  calendarId: "source-1",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2026-03-15T10:00:00Z"),
  id,
  sourceEventUid: `uid-${id}`,
  startTime: new Date("2026-03-15T09:00:00Z"),
  summary: `Event ${id}`,
});

const createProvider = () => {
  const deleted: string[][] = [];
  return {
    deleted,
    provider: {
      deleteEvents: (eventIds: string[]) => {
        deleted.push(eventIds);
        return Promise.resolve(eventIds.map(() => ({ success: true })));
      },
      listRemoteEvents: () => Promise.resolve([]),
      pushEvents: (events: MaterializedSyncableEvent[]) =>
        Promise.resolve(events.map((event) => ({
          deleteId: `remote-delete-${event.id}`,
          remoteId: `remote-${event.id}`,
          success: true,
        }))),
    },
  };
};

describe("copies whose ownership could not be recorded", () => {
  it("deletes the copies it just created when their mappings cannot be stored", async () => {
    const { deleted, provider } = createProvider();
    const storeFailure = new Error("insert or update on table \"event_mappings\" violates foreign key constraint");
    const events: Record<string, unknown>[] = [];

    await expect(syncCalendar({
      calendarId: "destination-1",
      flush: () => Promise.reject(storeFailure),
      isCurrent: () => Promise.resolve(true),
      onSyncEvent: (event) => { events.push(event); },
      provider,
      readState: () => Promise.resolve({
        existingMappings: [],
        localEvents: [makeEvent("ev-1"), makeEvent("ev-2")],
        remoteEvents: [],
      }),
      reconciliationScope: SCOPE,
      userId: "user-1",
    })).rejects.toBe(storeFailure);

    expect(deleted).toEqual([["remote-delete-ev-1", "remote-delete-ev-2"]]);
    expect(events[0]?.["events.unrecorded_deleted"]).toBe(2);
  });

  it("leaves copies alone when their mappings are stored", async () => {
    const { deleted, provider } = createProvider();

    await syncCalendar({
      calendarId: "destination-1",
      flush: () => Promise.resolve(),
      isCurrent: () => Promise.resolve(true),
      provider,
      readState: () => Promise.resolve({
        existingMappings: [],
        localEvents: [makeEvent("ev-1")],
        remoteEvents: [],
      }),
      reconciliationScope: SCOPE,
      userId: "user-1",
    });

    expect(deleted).toEqual([]);
  });
});

describe("copies that could not be undone", () => {
  it("still fails with the mapping error and counts the copies it could not delete", async () => {
    const storeFailure = new Error("destination calendar is gone");
    const events: Record<string, unknown>[] = [];

    await expect(syncCalendar({
      calendarId: "destination-1",
      flush: () => Promise.reject(storeFailure),
      isCurrent: () => Promise.resolve(true),
      onSyncEvent: (event) => { events.push(event); },
      provider: {
        deleteEvents: () => Promise.reject(new Error("provider unavailable")),
        listRemoteEvents: () => Promise.resolve([]),
        pushEvents: (pushed: MaterializedSyncableEvent[]) =>
          Promise.resolve(pushed.map((event) => ({ remoteId: `remote-${event.id}`, success: true }))),
      },
      readState: () => Promise.resolve({
        existingMappings: [],
        localEvents: [makeEvent("ev-1")],
        remoteEvents: [],
      }),
      reconciliationScope: SCOPE,
      userId: "user-1",
    })).rejects.toBe(storeFailure);

    expect(events[0]?.["events.unrecorded_delete_failed"]).toBe(1);
  });
});
