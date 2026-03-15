import { describe, expect, it } from "bun:test";
import { executeRemoteOperations } from "./index";
import type { SyncableEvent, SyncOperation, PushResult, DeleteResult, EventMapping } from "@keeper.sh/calendar";

const makeEvent = (id: string, startTime: Date, endTime: Date): SyncableEvent => ({
  id,
  sourceEventUid: `uid-${id}`,
  startTime,
  endTime,
  summary: `Event ${id}`,
  calendarId: "cal-1",
  calendarName: "Test Calendar",
  calendarUrl: null,
});

const makeMapping = (id: string, eventStateId: string, destinationEventUid: string): EventMapping => ({
  id,
  eventStateId,
  calendarId: "dest-cal-1",
  destinationEventUid,
  deleteIdentifier: destinationEventUid,
  syncEventHash: null,
  startTime: new Date("2026-03-15T09:00:00Z"),
  endTime: new Date("2026-03-15T10:00:00Z"),
});

describe("executeRemoteOperations", () => {
  it("accumulates mapping inserts from successful pushes without writing to database", async () => {
    const event = makeEvent("ev-1", new Date("2026-03-15T09:00:00Z"), new Date("2026-03-15T10:00:00Z"));
    const operations: SyncOperation[] = [{ type: "add", event }];

    const provider = {
      pushEvents: async (): Promise<PushResult[]> => [{ success: true, remoteId: "remote-1" }],
      deleteEvents: async (): Promise<DeleteResult[]> => [],
      listRemoteEvents: async () => [],
    };

    const outcome = await executeRemoteOperations(operations, [], "dest-cal-1", provider);

    expect(outcome).not.toBeNull();
    expect(outcome!.result.added).toBe(1);
    expect(outcome!.result.addFailed).toBe(0);
    expect(outcome!.changes.inserts).toHaveLength(1);
    expect(outcome!.changes.inserts[0]!.eventStateId).toBe("ev-1");
    expect(outcome!.changes.inserts[0]!.destinationEventUid).toBe("remote-1");
    expect(outcome!.changes.deletes).toHaveLength(0);
  });

  it("accumulates mapping deletes from successful removes", async () => {
    const mapping = makeMapping("map-1", "ev-1", "remote-1");
    const operations: SyncOperation[] = [{
      type: "remove",
      uid: "remote-1",
      deleteId: "remote-1",
      startTime: new Date("2026-03-15T09:00:00Z"),
    }];

    const provider = {
      pushEvents: async (): Promise<PushResult[]> => [],
      deleteEvents: async (): Promise<DeleteResult[]> => [{ success: true }],
      listRemoteEvents: async () => [],
    };

    const outcome = await executeRemoteOperations(operations, [mapping], "dest-cal-1", provider);

    expect(outcome).not.toBeNull();
    expect(outcome.result.removed).toBe(1);
    expect(outcome.result.removeFailed).toBe(0);
    expect(outcome.changes.deletes).toHaveLength(1);
    expect(outcome.changes.deletes[0]).toBe("map-1");
    expect(outcome.changes.inserts).toHaveLength(0);
  });

  it("counts failed pushes without accumulating changes", async () => {
    const event = makeEvent("ev-1", new Date("2026-03-15T09:00:00Z"), new Date("2026-03-15T10:00:00Z"));
    const operations: SyncOperation[] = [{ type: "add", event }];

    const provider = {
      pushEvents: async (): Promise<PushResult[]> => [{ success: false, error: "rate limited" }],
      deleteEvents: async (): Promise<DeleteResult[]> => [],
      listRemoteEvents: async () => [],
    };

    const outcome = await executeRemoteOperations(operations, [], "dest-cal-1", provider);

    expect(outcome).not.toBeNull();
    expect(outcome!.result.added).toBe(0);
    expect(outcome!.result.addFailed).toBe(1);
    expect(outcome!.changes.inserts).toHaveLength(0);
  });

  it("counts failed deletes without accumulating changes", async () => {
    const mapping = makeMapping("map-1", "ev-1", "remote-1");
    const operations: SyncOperation[] = [{
      type: "remove",
      uid: "remote-1",
      deleteId: "remote-1",
      startTime: new Date("2026-03-15T09:00:00Z"),
    }];

    const provider = {
      pushEvents: async (): Promise<PushResult[]> => [],
      deleteEvents: async (): Promise<DeleteResult[]> => [{ success: false, error: "server error" }],
      listRemoteEvents: async () => [],
    };

    const outcome = await executeRemoteOperations(operations, [mapping], "dest-cal-1", provider);

    expect(outcome).not.toBeNull();
    expect(outcome!.result.removed).toBe(0);
    expect(outcome!.result.removeFailed).toBe(1);
    expect(outcome!.changes.deletes).toHaveLength(0);
  });

  it("processes mixed add and remove operations in order", async () => {
    const event = makeEvent("ev-2", new Date("2026-03-16T09:00:00Z"), new Date("2026-03-16T10:00:00Z"));
    const mapping = makeMapping("map-1", "ev-1", "remote-1");

    const operations: SyncOperation[] = [
      {
        type: "remove",
        uid: "remote-1",
        deleteId: "remote-1",
        startTime: new Date("2026-03-15T09:00:00Z"),
      },
      { type: "add", event },
    ];

    const provider = {
      pushEvents: async (): Promise<PushResult[]> => [{ success: true, remoteId: "remote-2" }],
      deleteEvents: async (): Promise<DeleteResult[]> => [{ success: true }],
      listRemoteEvents: async () => [],
    };

    const outcome = await executeRemoteOperations(operations, [mapping], "dest-cal-1", provider);

    expect(outcome).not.toBeNull();
    expect(outcome!.result.added).toBe(1);
    expect(outcome!.result.removed).toBe(1);
    expect(outcome!.changes.inserts).toHaveLength(1);
    expect(outcome!.changes.deletes).toHaveLength(1);
  });

  it("uses deleteId as deleteIdentifier fallback when pushResult has no deleteId", async () => {
    const event = makeEvent("ev-1", new Date("2026-03-15T09:00:00Z"), new Date("2026-03-15T10:00:00Z"));
    const operations: SyncOperation[] = [{ type: "add", event }];

    const provider = {
      pushEvents: async (): Promise<PushResult[]> => [{ success: true, remoteId: "remote-1" }],
      deleteEvents: async (): Promise<DeleteResult[]> => [],
      listRemoteEvents: async () => [],
    };

    const outcome = await executeRemoteOperations(operations, [], "dest-cal-1", provider);

    expect(outcome!.changes.inserts[0]!.deleteIdentifier).toBe("remote-1");
  });

  it("uses explicit deleteId from pushResult when provided", async () => {
    const event = makeEvent("ev-1", new Date("2026-03-15T09:00:00Z"), new Date("2026-03-15T10:00:00Z"));
    const operations: SyncOperation[] = [{ type: "add", event }];

    const provider = {
      pushEvents: async (): Promise<PushResult[]> => [{ success: true, remoteId: "remote-1", deleteId: "delete-key-1" }],
      deleteEvents: async (): Promise<DeleteResult[]> => [],
      listRemoteEvents: async () => [],
    };

    const outcome = await executeRemoteOperations(operations, [], "dest-cal-1", provider);

    expect(outcome!.changes.inserts[0]!.deleteIdentifier).toBe("delete-key-1");
  });

  it("returns empty result for zero operations", async () => {
    const provider = {
      pushEvents: async (): Promise<PushResult[]> => [],
      deleteEvents: async (): Promise<DeleteResult[]> => [],
      listRemoteEvents: async () => [],
    };

    const outcome = await executeRemoteOperations([], [], "dest-cal-1", provider);

    expect(outcome).not.toBeNull();
    expect(outcome!.result.added).toBe(0);
    expect(outcome!.result.removed).toBe(0);
    expect(outcome!.changes.inserts).toHaveLength(0);
    expect(outcome!.changes.deletes).toHaveLength(0);
  });

  it("abandons work and returns null when generation becomes stale mid-operation", async () => {
    const event1 = makeEvent("ev-1", new Date("2026-03-15T09:00:00Z"), new Date("2026-03-15T10:00:00Z"));
    const event2 = makeEvent("ev-2", new Date("2026-03-16T09:00:00Z"), new Date("2026-03-16T10:00:00Z"));
    const operations: SyncOperation[] = [
      { type: "add", event: event1 },
      { type: "add", event: event2 },
    ];

    let pushCount = 0;
    const provider = {
      pushEvents: async (): Promise<PushResult[]> => {
        pushCount += 1;
        return [{ success: true, remoteId: `remote-${pushCount}` }];
      },
      deleteEvents: async (): Promise<DeleteResult[]> => [],
      listRemoteEvents: async () => [],
    };

    let checkCount = 0;
    const isCurrent = async (): Promise<boolean> => {
      checkCount += 1;
      return checkCount <= 1;
    };

    const outcome = await executeRemoteOperations(operations, [], "dest-cal-1", provider, isCurrent);

    expect(outcome).toBeNull();
    expect(pushCount).toBe(1);
  });

  it("processes all operations when generation stays current", async () => {
    const event1 = makeEvent("ev-1", new Date("2026-03-15T09:00:00Z"), new Date("2026-03-15T10:00:00Z"));
    const event2 = makeEvent("ev-2", new Date("2026-03-16T09:00:00Z"), new Date("2026-03-16T10:00:00Z"));
    const operations: SyncOperation[] = [
      { type: "add", event: event1 },
      { type: "add", event: event2 },
    ];

    const provider = {
      pushEvents: async (): Promise<PushResult[]> => [{ success: true, remoteId: "remote-x" }],
      deleteEvents: async (): Promise<DeleteResult[]> => [],
      listRemoteEvents: async () => [],
    };

    const alwaysCurrent = async (): Promise<boolean> => true;

    const outcome = await executeRemoteOperations(operations, [], "dest-cal-1", provider, alwaysCurrent);

    expect(outcome).not.toBeNull();
    expect(outcome!.result.added).toBe(2);
    expect(outcome!.changes.inserts).toHaveLength(2);
  });
});
