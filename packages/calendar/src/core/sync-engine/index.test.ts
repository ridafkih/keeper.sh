import { describe, expect, it } from "bun:test";
import { executeRemoteOperations } from "./index";
import type { SyncOperation, PushResult, DeleteResult, SyncableEvent } from "../types";
import type { EventMapping } from "../events/mappings";
import type { PendingChanges } from "./types";

const isDefined = <TValue>(value: TValue | null): value is TValue =>
  value !== null;

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

const makeProvider = (overrides: Partial<{
  pushEvents: () => Promise<PushResult[]>;
  deleteEvents: () => Promise<DeleteResult[]>;
  listRemoteEvents: () => Promise<never[]>;
}> = {}) => ({
  pushEvents: overrides.pushEvents ?? (() => Promise.resolve([])),
  deleteEvents: overrides.deleteEvents ?? (() => Promise.resolve([])),
  listRemoteEvents: overrides.listRemoteEvents ?? (() => Promise.resolve([])),
});

describe("executeRemoteOperations", () => {
  it("accumulates mapping inserts from successful pushes", async () => {
    const event = makeEvent("ev-1", new Date("2026-03-15T09:00:00Z"), new Date("2026-03-15T10:00:00Z"));
    const operations: SyncOperation[] = [{ type: "add", event }];
    const provider = makeProvider({ pushEvents: () => Promise.resolve([{ success: true, remoteId: "remote-1" }]) });

    const outcome = await executeRemoteOperations(operations, [], "dest-cal-1", provider);
    if (!isDefined(outcome)) {
      throw new Error("expected outcome");
    }

    expect(outcome.result.added).toBe(1);
    expect(outcome.result.addFailed).toBe(0);
    expect(outcome.changes.inserts).toHaveLength(1);
    expect(outcome.changes.inserts[0]?.eventStateId).toBe("ev-1");
    expect(outcome.changes.inserts[0]?.destinationEventUid).toBe("remote-1");
    expect(outcome.changes.deletes).toHaveLength(0);
  });

  it("accumulates mapping deletes from successful removes", async () => {
    const mapping = makeMapping("map-1", "ev-1", "remote-1");
    const operations: SyncOperation[] = [{ type: "remove", uid: "remote-1", deleteId: "remote-1", startTime: new Date("2026-03-15T09:00:00Z") }];
    const provider = makeProvider({ deleteEvents: () => Promise.resolve([{ success: true }]) });

    const outcome = await executeRemoteOperations(operations, [mapping], "dest-cal-1", provider);
    if (!isDefined(outcome)) {
      throw new Error("expected outcome");
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
    const provider = makeProvider({ pushEvents: () => Promise.resolve([{ success: false, error: "rate limited" }]) });

    const outcome = await executeRemoteOperations(operations, [], "dest-cal-1", provider);
    if (!isDefined(outcome)) {
      throw new Error("expected outcome");
    }

    expect(outcome.result.added).toBe(0);
    expect(outcome.result.addFailed).toBe(1);
    expect(outcome.changes.inserts).toHaveLength(0);
  });

  it("treats success without remoteId as a skip, not a failure", async () => {
    const event = makeEvent("ev-1", new Date("2026-03-15T09:00:00Z"), new Date("2026-03-15T10:00:00Z"));
    const operations: SyncOperation[] = [{ type: "add", event }];
    const provider = makeProvider({ pushEvents: () => Promise.resolve([{ success: true }]) });

    const outcome = await executeRemoteOperations(operations, [], "dest-cal-1", provider);
    if (!isDefined(outcome)) {
      throw new Error("expected outcome");
    }

    expect(outcome.result.added).toBe(0);
    expect(outcome.result.addFailed).toBe(0);
    expect(outcome.changes.inserts).toHaveLength(0);
  });

  it("counts failed deletes without accumulating changes", async () => {
    const mapping = makeMapping("map-1", "ev-1", "remote-1");
    const operations: SyncOperation[] = [{ type: "remove", uid: "remote-1", deleteId: "remote-1", startTime: new Date("2026-03-15T09:00:00Z") }];
    const provider = makeProvider({ deleteEvents: () => Promise.resolve([{ success: false, error: "server error" }]) });

    const outcome = await executeRemoteOperations(operations, [mapping], "dest-cal-1", provider);
    if (!isDefined(outcome)) {
      throw new Error("expected outcome");
    }

    expect(outcome.result.removed).toBe(0);
    expect(outcome.result.removeFailed).toBe(1);
    expect(outcome.changes.deletes).toHaveLength(0);
  });

  it("processes mixed add and remove operations in order", async () => {
    const event = makeEvent("ev-2", new Date("2026-03-16T09:00:00Z"), new Date("2026-03-16T10:00:00Z"));
    const mapping = makeMapping("map-1", "ev-1", "remote-1");
    const operations: SyncOperation[] = [
      { type: "remove", uid: "remote-1", deleteId: "remote-1", startTime: new Date("2026-03-15T09:00:00Z") },
      { type: "add", event },
    ];
    const provider = makeProvider({
      pushEvents: () => Promise.resolve([{ success: true, remoteId: "remote-2" }]),
      deleteEvents: () => Promise.resolve([{ success: true }]),
    });

    const outcome = await executeRemoteOperations(operations, [mapping], "dest-cal-1", provider);
    if (!isDefined(outcome)) {
      throw new Error("expected outcome");
    }

    expect(outcome.result.added).toBe(1);
    expect(outcome.result.removed).toBe(1);
    expect(outcome.changes.inserts).toHaveLength(1);
    expect(outcome.changes.deletes).toHaveLength(1);
  });

  it("uses remoteId as deleteIdentifier fallback when pushResult has no deleteId", async () => {
    const event = makeEvent("ev-1", new Date("2026-03-15T09:00:00Z"), new Date("2026-03-15T10:00:00Z"));
    const operations: SyncOperation[] = [{ type: "add", event }];
    const provider = makeProvider({ pushEvents: () => Promise.resolve([{ success: true, remoteId: "remote-1" }]) });

    const outcome = await executeRemoteOperations(operations, [], "dest-cal-1", provider);
    if (!isDefined(outcome)) {
      throw new Error("expected outcome");
    }

    expect(outcome.changes.inserts[0]?.deleteIdentifier).toBe("remote-1");
  });

  it("uses explicit deleteId from pushResult when provided", async () => {
    const event = makeEvent("ev-1", new Date("2026-03-15T09:00:00Z"), new Date("2026-03-15T10:00:00Z"));
    const operations: SyncOperation[] = [{ type: "add", event }];
    const provider = makeProvider({ pushEvents: () => Promise.resolve([{ success: true, remoteId: "remote-1", deleteId: "delete-key-1" }]) });

    const outcome = await executeRemoteOperations(operations, [], "dest-cal-1", provider);
    if (!isDefined(outcome)) {
      throw new Error("expected outcome");
    }

    expect(outcome.changes.inserts[0]?.deleteIdentifier).toBe("delete-key-1");
  });

  it("returns empty result for zero operations", async () => {
    const provider = makeProvider();

    const outcome = await executeRemoteOperations([], [], "dest-cal-1", provider);
    if (!isDefined(outcome)) {
      throw new Error("expected outcome");
    }

    expect(outcome.result.added).toBe(0);
    expect(outcome.result.removed).toBe(0);
    expect(outcome.changes.inserts).toHaveLength(0);
    expect(outcome.changes.deletes).toHaveLength(0);
  });

  it("abandons work and returns null when generation becomes stale mid-operation", async () => {
    const event1 = makeEvent("ev-1", new Date("2026-03-15T09:00:00Z"), new Date("2026-03-15T10:00:00Z"));
    const event2 = makeEvent("ev-2", new Date("2026-03-16T09:00:00Z"), new Date("2026-03-16T10:00:00Z"));
    const operations: SyncOperation[] = [{ type: "add", event: event1 }, { type: "add", event: event2 }];

    let pushCount = 0;
    const provider = makeProvider({
      pushEvents: () => {
        pushCount += 1;
        return Promise.resolve([{ success: true, remoteId: `remote-${pushCount}` }]);
      },
    });

    let checkCount = 0;
    const isCurrent = (): Promise<boolean> => {
      checkCount += 1;
      return Promise.resolve(checkCount <= 1);
    };

    const outcome = await executeRemoteOperations(operations, [], "dest-cal-1", provider, isCurrent);

    expect(outcome).toBeNull();
    expect(pushCount).toBe(1);
  });

  it("processes all operations when generation stays current", async () => {
    const event1 = makeEvent("ev-1", new Date("2026-03-15T09:00:00Z"), new Date("2026-03-15T10:00:00Z"));
    const event2 = makeEvent("ev-2", new Date("2026-03-16T09:00:00Z"), new Date("2026-03-16T10:00:00Z"));
    const operations: SyncOperation[] = [{ type: "add", event: event1 }, { type: "add", event: event2 }];
    const provider = makeProvider({ pushEvents: () => Promise.resolve([{ success: true, remoteId: "remote-x" }]) });

    const outcome = await executeRemoteOperations(operations, [], "dest-cal-1", provider, () => Promise.resolve(true));
    if (!isDefined(outcome)) {
      throw new Error("expected outcome");
    }

    expect(outcome.result.added).toBe(2);
    expect(outcome.changes.inserts).toHaveLength(2);
  });
});

describe("syncCalendar", () => {
  it("pushes new events and flushes accumulated changes at the end", async () => {
    const { syncCalendar } = await import("./index");
    const localEvent = makeEvent("ev-1", new Date("2026-03-15T09:00:00Z"), new Date("2026-03-15T10:00:00Z"));
    const provider = makeProvider({ pushEvents: () => Promise.resolve([{ success: true, remoteId: "remote-1" }]) });

    const flushCapture: PendingChanges[] = [];

    const result = await syncCalendar({
      calendarId: "dest-cal-1",
      provider,
      readState: () => Promise.resolve({ localEvents: [localEvent], existingMappings: [], remoteEvents: [] }),
      isCurrent: () => Promise.resolve(true),
      flush: (changes) => { flushCapture.push(changes); return Promise.resolve(); },
    });

    expect(result.added).toBe(1);
    expect(result.addFailed).toBe(0);
    expect(flushCapture).toHaveLength(1);
    expect(flushCapture[0]?.inserts).toHaveLength(1);
    expect(flushCapture[0]?.inserts[0]?.destinationEventUid).toBe("remote-1");
  });

  it("returns accurate counts but skips flush when superseded after remote operations", async () => {
    const { syncCalendar } = await import("./index");
    const localEvent = makeEvent("ev-1", new Date("2026-03-15T09:00:00Z"), new Date("2026-03-15T10:00:00Z"));
    const provider = makeProvider({ pushEvents: () => Promise.resolve([{ success: true, remoteId: "remote-1" }]) });

    let flushCalled = false;
    let checkCount = 0;

    const result = await syncCalendar({
      calendarId: "dest-cal-1",
      provider,
      readState: () => Promise.resolve({ localEvents: [localEvent], existingMappings: [], remoteEvents: [] }),
      isCurrent: () => { checkCount += 1; return Promise.resolve(checkCount <= 2); },
      flush: () => { flushCalled = true; return Promise.resolve(); },
    });

    expect(result.added).toBe(1);
    expect(flushCalled).toBe(false);
  });

  it("returns empty result when there are no operations", async () => {
    const { syncCalendar } = await import("./index");
    const provider = makeProvider();
    let flushCalled = false;

    const result = await syncCalendar({
      calendarId: "dest-cal-1",
      provider,
      readState: () => Promise.resolve({ localEvents: [], existingMappings: [], remoteEvents: [] }),
      isCurrent: () => Promise.resolve(true),
      flush: () => { flushCalled = true; return Promise.resolve(); },
    });

    expect(result.added).toBe(0);
    expect(result.removed).toBe(0);
    expect(flushCalled).toBe(false);
  });

  it("emits a wide event with sync context when onSyncEvent is provided", async () => {
    const { syncCalendar } = await import("./index");
    const localEvent = makeEvent("ev-1", new Date("2026-03-15T09:00:00Z"), new Date("2026-03-15T10:00:00Z"));
    const provider = makeProvider({ pushEvents: () => Promise.resolve([{ success: true, remoteId: "remote-1" }]) });

    const emittedEvents: Record<string, unknown>[] = [];

    await syncCalendar({
      calendarId: "dest-cal-1",
      provider,
      readState: () => Promise.resolve({ localEvents: [localEvent], existingMappings: [], remoteEvents: [] }),
      isCurrent: () => Promise.resolve(true),
      flush: () => Promise.resolve(),
      onSyncEvent: (event) => { emittedEvents.push(event); },
    });

    expect(emittedEvents).toHaveLength(1);

    const [event] = emittedEvents;
    expect(event?.["calendar.id"]).toBe("dest-cal-1");
    expect(event?.["local_events.count"]).toBe(1);
    expect(event?.["remote_events.count"]).toBe(0);
    expect(event?.["existing_mappings.count"]).toBe(0);
    expect(event?.["operations.add_count"]).toBe(1);
    expect(event?.["operations.remove_count"]).toBe(0);
    expect(event?.["events.added"]).toBe(1);
    expect(event?.["events.add_failed"]).toBe(0);
    expect(event?.["events.removed"]).toBe(0);
    expect(event?.["events.remove_failed"]).toBe(0);
    expect(event?.["outcome"]).toBe("success");
    expect(event?.["flushed"]).toBe(true);
    expect(typeof event?.["duration_ms"]).toBe("number");
  });

  it("emits a wide event with outcome superseded when generation becomes stale", async () => {
    const { syncCalendar } = await import("./index");
    const localEvent = makeEvent("ev-1", new Date("2026-03-15T09:00:00Z"), new Date("2026-03-15T10:00:00Z"));
    const provider = makeProvider({ pushEvents: () => Promise.resolve([{ success: true, remoteId: "remote-1" }]) });

    const emittedEvents: Record<string, unknown>[] = [];
    let checkCount = 0;

    await syncCalendar({
      calendarId: "dest-cal-1",
      provider,
      readState: () => Promise.resolve({ localEvents: [localEvent], existingMappings: [], remoteEvents: [] }),
      isCurrent: () => { checkCount += 1; return Promise.resolve(checkCount <= 1); },
      flush: () => Promise.resolve(),
      onSyncEvent: (event) => { emittedEvents.push(event); },
    });

    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0]?.["outcome"]).toBe("superseded");
    expect(emittedEvents[0]?.["flushed"]).toBe(false);
  });

  it("emits a wide event with outcome in-sync when there are no operations", async () => {
    const { syncCalendar } = await import("./index");
    const provider = makeProvider();

    const emittedEvents: Record<string, unknown>[] = [];

    await syncCalendar({
      calendarId: "dest-cal-1",
      provider,
      readState: () => Promise.resolve({ localEvents: [], existingMappings: [], remoteEvents: [] }),
      isCurrent: () => Promise.resolve(true),
      flush: () => Promise.resolve(),
      onSyncEvent: (event) => { emittedEvents.push(event); },
    });

    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0]?.["outcome"]).toBe("in-sync");
    expect(emittedEvents[0]?.["flushed"]).toBe(false);
  });

  it("emits a wide event with error details when sync throws", async () => {
    const { syncCalendar } = await import("./index");
    const provider = makeProvider();

    const emittedEvents: Record<string, unknown>[] = [];

    try {
      await syncCalendar({
        calendarId: "dest-cal-1",
        provider,
        readState: () => Promise.reject(new Error("db connection failed")),
        isCurrent: () => Promise.resolve(true),
        flush: () => Promise.resolve(),
        onSyncEvent: (event) => { emittedEvents.push(event); },
      });
    } catch {
      // Expected to throw
    }

    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0]?.["outcome"]).toBe("error");
    expect(emittedEvents[0]?.["error.message"]).toBe("db connection failed");
    expect(typeof emittedEvents[0]?.["duration_ms"]).toBe("number");
  });
});

describe("createRedisGenerationCheck", () => {
  it("returns true when the generation counter has not been incremented", async () => {
    const { createRedisGenerationCheck } = await import("./generation");
    type GenerationStore = Parameters<typeof createRedisGenerationCheck>[0];

    let counter = 0;
    const store: GenerationStore = {
      incr: () => { counter += 1; return Promise.resolve(counter); },
      get: () => Promise.resolve(String(counter)),
    };

    const isCurrent = await createRedisGenerationCheck(store, "cal-1");
    expect(await isCurrent()).toBe(true);
  });

  it("returns false when another caller increments the generation", async () => {
    const { createRedisGenerationCheck } = await import("./generation");
    type GenerationStore = Parameters<typeof createRedisGenerationCheck>[0];

    let counter = 0;
    const store: GenerationStore = {
      incr: () => { counter += 1; return Promise.resolve(counter); },
      get: () => Promise.resolve(String(counter)),
    };

    const isCurrent = await createRedisGenerationCheck(store, "cal-1");
    counter += 1;
    expect(await isCurrent()).toBe(false);
  });

  it("sets a TTL on the generation key", async () => {
    const { createRedisGenerationCheck, GENERATION_TTL_SECONDS } = await import("./generation");
    type GenerationStore = Parameters<typeof createRedisGenerationCheck>[0];

    let counter = 0;
    const expireCalls: { key: string; seconds: number }[] = [];
    const store: GenerationStore = {
      incr: () => { counter += 1; return Promise.resolve(counter); },
      get: () => Promise.resolve(String(counter)),
      expire: (key, seconds) => { expireCalls.push({ key, seconds }); return Promise.resolve(1); },
    };

    await createRedisGenerationCheck(store, "cal-1");

    expect(expireCalls).toHaveLength(1);
    expect(expireCalls[0]?.key).toBe("sync:gen:cal-1");
    expect(expireCalls[0]?.seconds).toBe(GENERATION_TTL_SECONDS);
  });
});

describe("createDatabaseFlush", () => {
  it("batches all inserts and deletes into a single transaction", async () => {
    const { createDatabaseFlush } = await import("./flush");
    const executedOperations: string[] = [];

    const fakeDatabase = {
      transaction: (callback: (tx: unknown) => Promise<void>) => {
        const tx = {
          insert: () => { executedOperations.push("insert"); return { values: () => Promise.resolve() }; },
          delete: () => { executedOperations.push("delete"); return { where: () => Promise.resolve() }; },
        };
        return callback(tx);
      },
    };

    const flush = createDatabaseFlush(fakeDatabase as never);
    await flush({
      inserts: [{
        eventStateId: "ev-1", calendarId: "cal-1", destinationEventUid: "remote-1",
        deleteIdentifier: "remote-1", syncEventHash: null,
        startTime: new Date("2026-03-15T09:00:00Z"), endTime: new Date("2026-03-15T10:00:00Z"),
      }],
      deletes: ["map-1", "map-2"],
    });

    expect(executedOperations).toEqual(["delete", "insert"]);
  });

  it("skips delete when there are no deletes", async () => {
    const { createDatabaseFlush } = await import("./flush");
    const executedOperations: string[] = [];
    const fakeDatabase = {
      transaction: (callback: (tx: unknown) => Promise<void>) => {
        const tx = {
          insert: () => { executedOperations.push("insert"); return { values: () => Promise.resolve() }; },
          delete: () => { executedOperations.push("delete"); return { where: () => Promise.resolve() }; },
        };
        return callback(tx);
      },
    };

    const flush = createDatabaseFlush(fakeDatabase as never);
    await flush({
      inserts: [{
        eventStateId: "ev-1", calendarId: "cal-1", destinationEventUid: "remote-1",
        deleteIdentifier: "remote-1", syncEventHash: null,
        startTime: new Date("2026-03-15T09:00:00Z"), endTime: new Date("2026-03-15T10:00:00Z"),
      }],
      deletes: [],
    });

    expect(executedOperations).toEqual(["insert"]);
  });

  it("skips insert when there are no inserts", async () => {
    const { createDatabaseFlush } = await import("./flush");
    const executedOperations: string[] = [];
    const fakeDatabase = {
      transaction: (callback: (tx: unknown) => Promise<void>) => {
        const tx = {
          insert: () => { executedOperations.push("insert"); return { values: () => Promise.resolve() }; },
          delete: () => { executedOperations.push("delete"); return { where: () => Promise.resolve() }; },
        };
        return callback(tx);
      },
    };

    const flush = createDatabaseFlush(fakeDatabase as never);
    await flush({ inserts: [], deletes: ["map-1"] });

    expect(executedOperations).toEqual(["delete"]);
  });

  it("does nothing when changes are empty", async () => {
    const { createDatabaseFlush } = await import("./flush");
    let transactionCalled = false;
    const fakeDatabase = {
      transaction: () => { transactionCalled = true; return Promise.resolve(); },
    };

    const flush = createDatabaseFlush(fakeDatabase as never);
    await flush({ inserts: [], deletes: [] });

    expect(transactionCalled).toBe(false);
  });

  it("chunks deletes into batches to avoid exceeding parameter limits", async () => {
    const { createDatabaseFlush, FLUSH_BATCH_SIZE } = await import("./flush");
    let deleteCallCount = 0;

    const fakeDatabase = {
      transaction: (callback: (tx: unknown) => Promise<void>) => {
        const tx = {
          insert: () => ({ values: () => Promise.resolve() }),
          delete: () => { deleteCallCount += 1; return { where: () => Promise.resolve() }; },
        };
        return callback(tx);
      },
    };

    const deleteIds = Array.from({ length: FLUSH_BATCH_SIZE + 10 }, (_entry, idx) => `map-${idx}`);

    const flush = createDatabaseFlush(fakeDatabase as never);
    await flush({ inserts: [], deletes: deleteIds });

    expect(deleteCallCount).toBe(2);
  });

  it("chunks inserts into batches to avoid exceeding parameter limits", async () => {
    const { createDatabaseFlush, FLUSH_BATCH_SIZE } = await import("./flush");
    let insertCallCount = 0;

    const fakeDatabase = {
      transaction: (callback: (tx: unknown) => Promise<void>) => {
        const tx = {
          insert: () => {
            insertCallCount += 1;
            return { values: () => Promise.resolve() };
          },
          delete: () => ({ where: () => Promise.resolve() }),
        };
        return callback(tx);
      },
    };

    const inserts = Array.from({ length: FLUSH_BATCH_SIZE + 10 }, (_entry, idx) => ({
      eventStateId: `ev-${idx}`, calendarId: "cal-1", destinationEventUid: `remote-${idx}`,
      deleteIdentifier: `remote-${idx}`, syncEventHash: null,
      startTime: new Date("2026-03-15T09:00:00Z"), endTime: new Date("2026-03-15T10:00:00Z"),
    }));

    const flush = createDatabaseFlush(fakeDatabase as never);
    await flush({ inserts, deletes: [] });

    expect(insertCallCount).toBe(2);
  });

  it("calls insert once for multiple inserts using bulk values", async () => {
    const { createDatabaseFlush } = await import("./flush");
    let insertCallCount = 0;
    let valuesReceived: unknown[] = [];

    const fakeDatabase = {
      transaction: (callback: (tx: unknown) => Promise<void>) => {
        const tx = {
          insert: () => {
            insertCallCount += 1;
            return {
              values: (rows: unknown[]) => { valuesReceived = rows; return Promise.resolve(); },
            };
          },
          delete: () => ({ where: () => Promise.resolve() }),
        };
        return callback(tx);
      },
    };

    const flush = createDatabaseFlush(fakeDatabase as never);
    await flush({
      inserts: [
        {
          eventStateId: "ev-1", calendarId: "cal-1", destinationEventUid: "remote-1",
          deleteIdentifier: "remote-1", syncEventHash: null,
          startTime: new Date("2026-03-15T09:00:00Z"), endTime: new Date("2026-03-15T10:00:00Z"),
        },
        {
          eventStateId: "ev-2", calendarId: "cal-1", destinationEventUid: "remote-2",
          deleteIdentifier: "remote-2", syncEventHash: null,
          startTime: new Date("2026-03-16T09:00:00Z"), endTime: new Date("2026-03-16T10:00:00Z"),
        },
      ],
      deletes: [],
    });

    expect(insertCallCount).toBe(1);
    expect(valuesReceived).toHaveLength(2);
  });
});
