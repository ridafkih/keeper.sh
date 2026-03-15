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

    if (outcome === null) {
      throw new Error("Expected outcome to not be null");
    }

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

describe("syncCalendar", () => {
  it("pushes new events and returns accumulated results without flushing until the end", async () => {
    const { syncCalendar } = await import("./index");

    const localEvent = makeEvent("ev-1", new Date("2026-03-15T09:00:00Z"), new Date("2026-03-15T10:00:00Z"));

    const provider = {
      pushEvents: async (): Promise<PushResult[]> => [{ success: true, remoteId: "remote-1" }],
      deleteEvents: async (): Promise<DeleteResult[]> => [],
      listRemoteEvents: async () => [],
    };

    let flushedChanges: import("./types").PendingChanges | null = null;

    const result = await syncCalendar({
      calendarId: "dest-cal-1",
      provider,
      readState: async () => ({
        localEvents: [localEvent],
        existingMappings: [],
        remoteEvents: [],
      }),
      isCurrent: async () => true,
      flush: async (changes) => {
        flushedChanges = changes;
      },
    });

    expect(result.added).toBe(1);
    expect(result.addFailed).toBe(0);
    expect(flushedChanges).not.toBeNull();
    expect(flushedChanges!.inserts).toHaveLength(1);
    expect(flushedChanges!.inserts[0]!.destinationEventUid).toBe("remote-1");
  });

  it("does not flush when generation becomes stale before flush", async () => {
    const { syncCalendar } = await import("./index");

    const localEvent = makeEvent("ev-1", new Date("2026-03-15T09:00:00Z"), new Date("2026-03-15T10:00:00Z"));

    const provider = {
      pushEvents: async (): Promise<PushResult[]> => [{ success: true, remoteId: "remote-1" }],
      deleteEvents: async (): Promise<DeleteResult[]> => [],
      listRemoteEvents: async () => [],
    };

    let flushCalled = false;
    let checkCount = 0;

    const result = await syncCalendar({
      calendarId: "dest-cal-1",
      provider,
      readState: async () => ({
        localEvents: [localEvent],
        existingMappings: [],
        remoteEvents: [],
      }),
      isCurrent: async () => {
        checkCount += 1;
        return checkCount <= 2;
      },
      flush: async () => {
        flushCalled = true;
      },
    });

    expect(result.added).toBe(0);
    expect(flushCalled).toBe(false);
  });

  it("returns empty result when there are no operations", async () => {
    const { syncCalendar } = await import("./index");

    const provider = {
      pushEvents: async (): Promise<PushResult[]> => [],
      deleteEvents: async (): Promise<DeleteResult[]> => [],
      listRemoteEvents: async () => [],
    };

    let flushCalled = false;

    const result = await syncCalendar({
      calendarId: "dest-cal-1",
      provider,
      readState: async () => ({
        localEvents: [],
        existingMappings: [],
        remoteEvents: [],
      }),
      isCurrent: async () => true,
      flush: async () => {
        flushCalled = true;
      },
    });

    expect(result.added).toBe(0);
    expect(result.removed).toBe(0);
    expect(flushCalled).toBe(false);
  });
});

describe("createRedisGenerationCheck", () => {
  it("returns true when the generation counter has not been incremented by another caller", async () => {
    const { createRedisGenerationCheck } = await import("./generation");
    type GenerationStore = Parameters<typeof createRedisGenerationCheck>[0];

    let counter = 0;
    const store: GenerationStore = {
      incr: async () => {
        counter += 1;
        return counter;
      },
      get: async () => String(counter),
    };

    const isCurrent = await createRedisGenerationCheck(store, "cal-1");

    expect(await isCurrent()).toBe(true);
  });

  it("returns false when another caller increments the generation", async () => {
    const { createRedisGenerationCheck } = await import("./generation");
    type GenerationStore = Parameters<typeof createRedisGenerationCheck>[0];

    let counter = 0;
    const store: GenerationStore = {
      incr: async () => {
        counter += 1;
        return counter;
      },
      get: async () => String(counter),
    };

    const isCurrent = await createRedisGenerationCheck(store, "cal-1");

    counter += 1;

    expect(await isCurrent()).toBe(false);
  });
});

describe("createDatabaseFlush", () => {
  it("batches all inserts and deletes into a single transaction callback", async () => {
    const { createDatabaseFlush } = await import("./flush");
    type TransactionClient = Parameters<Parameters<typeof createDatabaseFlush>[0]["transaction"]>[0] extends (tx: infer T) => unknown ? T : never;

    const executedOperations: string[] = [];

    const fakeTransaction = async (callback: (tx: TransactionClient) => Promise<void>) => {
      const tx = {
        insert: () => {
          executedOperations.push("insert");
          return { values: () => Promise.resolve() };
        },
        delete: () => {
          executedOperations.push("delete");
          return { where: () => Promise.resolve() };
        },
      };
      await callback(tx as unknown as TransactionClient);
    };

    const flush = createDatabaseFlush({ transaction: fakeTransaction } as never);

    await flush({
      inserts: [
        {
          eventStateId: "ev-1",
          calendarId: "cal-1",
          destinationEventUid: "remote-1",
          deleteIdentifier: "remote-1",
          syncEventHash: null,
          startTime: new Date("2026-03-15T09:00:00Z"),
          endTime: new Date("2026-03-15T10:00:00Z"),
        },
      ],
      deletes: ["map-1", "map-2"],
    });

    expect(executedOperations).toEqual(["delete", "insert"]);
  });

  it("skips delete when there are no deletes", async () => {
    const { createDatabaseFlush } = await import("./flush");

    const executedOperations: string[] = [];

    const fakeTransaction = async (callback: (tx: unknown) => Promise<void>) => {
      const tx = {
        insert: () => {
          executedOperations.push("insert");
          return { values: () => Promise.resolve() };
        },
        delete: () => {
          executedOperations.push("delete");
          return { where: () => Promise.resolve() };
        },
      };
      await callback(tx);
    };

    const flush = createDatabaseFlush({ transaction: fakeTransaction } as never);

    await flush({
      inserts: [
        {
          eventStateId: "ev-1",
          calendarId: "cal-1",
          destinationEventUid: "remote-1",
          deleteIdentifier: "remote-1",
          syncEventHash: null,
          startTime: new Date("2026-03-15T09:00:00Z"),
          endTime: new Date("2026-03-15T10:00:00Z"),
        },
      ],
      deletes: [],
    });

    expect(executedOperations).toEqual(["insert"]);
  });

  it("skips insert when there are no inserts", async () => {
    const { createDatabaseFlush } = await import("./flush");

    const executedOperations: string[] = [];

    const fakeTransaction = async (callback: (tx: unknown) => Promise<void>) => {
      const tx = {
        insert: () => {
          executedOperations.push("insert");
          return { values: () => Promise.resolve() };
        },
        delete: () => {
          executedOperations.push("delete");
          return { where: () => Promise.resolve() };
        },
      };
      await callback(tx);
    };

    const flush = createDatabaseFlush({ transaction: fakeTransaction } as never);

    await flush({ inserts: [], deletes: ["map-1"] });

    expect(executedOperations).toEqual(["delete"]);
  });

  it("does nothing when changes are empty", async () => {
    const { createDatabaseFlush } = await import("./flush");

    let transactionCalled = false;

    const fakeTransaction = async () => {
      transactionCalled = true;
    };

    const flush = createDatabaseFlush({ transaction: fakeTransaction } as never);

    await flush({ inserts: [], deletes: [] });

    expect(transactionCalled).toBe(false);
  });
});
