import { describe, expect, it } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import type {
  DeleteResult,
  MaterializedSyncableEvent,
  PushResult,
  SyncOperation,
} from "../../../src/core/types";
import type { EventMapping } from "../../../src/core/events/mappings";
import type { PendingChanges } from "../../../src/core/sync-engine/types";
import {
  createEditableEventContentHash,
  createSyncEventContentHash,
} from "../../../src/core/events/content-hash";
import { RecurrenceMaterializationLimitError } from "../../../src/core/events/recurrence-materializer";

const makeEvent = (
  id: string,
  startTime: Date,
  endTime: Date,
): MaterializedSyncableEvent => ({
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
  syncEventId: eventStateId,
  calendarId: "dest-cal-1",
  destinationEventUid,
  deleteIdentifier: destinationEventUid,
  syncEventHash: null,
  startTime: new Date("2026-03-15T09:00:00Z"),
  endTime: new Date("2026-03-15T10:00:00Z"),
});

const makeProvider = (overrides: Partial<{
  pushEvents: (events: MaterializedSyncableEvent[]) => Promise<PushResult[]>;
  deleteEvents: (eventIds: string[]) => Promise<DeleteResult[]>;
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


    expect(outcome.result.added).toBe(1);
    expect(outcome.result.addFailed).toBe(0);
    expect(outcome.changes.inserts).toHaveLength(1);
    expect(outcome.changes.inserts[0]?.eventStateId).toBe("ev-1");
    expect(outcome.changes.inserts[0]?.syncEventId).toBe("ev-1");
    expect(outcome.changes.inserts[0]?.destinationEventUid).toBe("remote-1");
    expect(outcome.changes.deletes).toHaveLength(0);
  });

  it("checkpoints a materialized occurrence against its real owning event-state row", async () => {
    const occurrence = {
      ...makeEvent(
        "recurrence-synthetic-id",
        new Date("2026-03-15T09:00:00Z"),
        new Date("2026-03-15T10:00:00Z"),
      ),
      eventStateId: "019c0000-0000-7000-8000-000000000001",
    };
    const provider = makeProvider({
      pushEvents: () => Promise.resolve([{
        deleteId: "provider-delete-id",
        remoteId: "provider-uid",
        success: true,
      }]),
    });

    const outcome = await executeRemoteOperations(
      [{ event: occurrence, type: "add" }],
      [],
      "dest-cal-1",
      provider,
    );

    expect(outcome.changes.inserts).toMatchObject([{
      eventStateId: "019c0000-0000-7000-8000-000000000001",
      syncEventId: "recurrence-synthetic-id",
    }]);
  });

  it("accumulates mapping deletes from successful removes", async () => {
    const mapping = makeMapping("map-1", "ev-1", "remote-1");
    const operations: SyncOperation[] = [{ type: "remove", uid: "remote-1", deleteId: "remote-1", startTime: new Date("2026-03-15T09:00:00Z") }];
    const provider = makeProvider({ deleteEvents: () => Promise.resolve([{ success: true }]) });

    const outcome = await executeRemoteOperations(operations, [mapping], "dest-cal-1", provider);


    expect(outcome.result.removed).toBe(1);
    expect(outcome.result.removeFailed).toBe(0);
    expect(outcome.changes.deletes).toHaveLength(1);
    expect(outcome.changes.deletes[0]).toBe("map-1");
    expect(outcome.changes.inserts).toHaveLength(0);
  });

  it("counts failed pushes without accumulating changes", async () => {
    const event = makeEvent("ev-1", new Date("2026-03-15T09:00:00Z"), new Date("2026-03-15T10:00:00Z"));
    const operations: SyncOperation[] = [{ type: "add", event }];
    const provider = makeProvider({
      pushEvents: () => Promise.resolve([{
        success: false,
        error: "CalDAV create failed: 503 Service Unavailable",
        errorType: "CalDAVHttpError",
        statusCode: 503,
      }]),
    });

    const outcome = await executeRemoteOperations(operations, [], "dest-cal-1", provider);


    expect(outcome.result.added).toBe(0);
    expect(outcome.result.addFailed).toBe(1);
    expect(outcome.changes.inserts).toHaveLength(0);
    expect(outcome.errors).toEqual([{
      type: "add",
      error: "CalDAV create failed: 503 Service Unavailable",
      errorType: "CalDAVHttpError",
      statusCode: 503,
    }]);
  });

  it("treats success without remoteId as a skip, not a failure", async () => {
    const event = makeEvent("ev-1", new Date("2026-03-15T09:00:00Z"), new Date("2026-03-15T10:00:00Z"));
    const operations: SyncOperation[] = [{ type: "add", event }];
    const provider = makeProvider({ pushEvents: () => Promise.resolve([{ success: true }]) });

    const outcome = await executeRemoteOperations(operations, [], "dest-cal-1", provider);


    expect(outcome.result.added).toBe(0);
    expect(outcome.result.addFailed).toBe(0);
    expect(outcome.changes.inserts).toHaveLength(0);
  });

  it("removes the stale mapping when a replacement is intentionally skipped", async () => {
    const event = makeEvent("ev-1", new Date("2026-03-15T11:00:00Z"), new Date("2026-03-15T12:00:00Z"));
    const mapping = makeMapping("map-1", "ev-1", "remote-1");
    const operations: SyncOperation[] = [{
      deleteId: "remote-1",
      event,
      staleMappingId: mapping.id,
      type: "replace",
      uid: "remote-1",
    }];
    const provider = makeProvider({
      deleteEvents: () => Promise.resolve([{ success: true }]),
      pushEvents: () => Promise.resolve([{ success: true }]),
    });

    const outcome = await executeRemoteOperations(operations, [mapping], "dest-cal-1", provider);

    expect(outcome.result.removed).toBe(1);
    expect(outcome.result.addFailed).toBe(0);
    expect(outcome.changes.deletes).toEqual([mapping.id]);
    expect(outcome.changes.inserts).toHaveLength(0);
  });

  it("counts failed deletes without accumulating changes", async () => {
    const mapping = makeMapping("map-1", "ev-1", "remote-1");
    const operations: SyncOperation[] = [{ type: "remove", uid: "remote-1", deleteId: "remote-1", startTime: new Date("2026-03-15T09:00:00Z") }];
    const provider = makeProvider({ deleteEvents: () => Promise.resolve([{ success: false, error: "server error" }]) });

    const outcome = await executeRemoteOperations(operations, [mapping], "dest-cal-1", provider);


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


    expect(outcome.result.added).toBe(1);
    expect(outcome.result.removed).toBe(1);
    expect(outcome.changes.inserts).toHaveLength(1);
    expect(outcome.changes.deletes).toHaveLength(1);
  });

  it("does not delete a remote UID that was recovered by an earlier add", async () => {
    const event = makeEvent("ev-1", new Date("2026-03-15T09:00:00Z"), new Date("2026-03-15T10:00:00Z"));
    const addOperations: SyncOperation[] = [
      { event, type: "add" },
      ...Array.from({ length: 49 }, (_value, index): SyncOperation => ({
        event: makeEvent(
          `ev-extra-${index}`,
          new Date(Date.UTC(2026, 2, 15, 11, index)),
          new Date(Date.UTC(2026, 2, 15, 12, index)),
        ),
        type: "add",
      })),
    ];
    const operations: SyncOperation[] = [
      ...addOperations,
      { type: "remove", uid: "remote-1", deleteId: "remote-1", startTime: event.startTime },
    ];
    let deleteCalled = false;
    const provider = makeProvider({
      pushEvents: (events) => Promise.resolve(events.map((pushedEvent) => {
        let remoteId = `remote-${pushedEvent.id}`;
        if (pushedEvent.id === event.id) {
          remoteId = "remote-1";
        }
        return { remoteId, success: true };
      })),
      deleteEvents: () => {
        deleteCalled = true;
        return Promise.resolve([{ success: true }]);
      },
    });

    const outcome = await executeRemoteOperations(operations, [], "dest-cal-1", provider);

    expect(outcome.result.added).toBe(50);
    expect(deleteCalled).toBe(false);
  });

  it("uses remoteId as deleteIdentifier fallback when pushResult has no deleteId", async () => {
    const event = makeEvent("ev-1", new Date("2026-03-15T09:00:00Z"), new Date("2026-03-15T10:00:00Z"));
    const operations: SyncOperation[] = [{ type: "add", event }];
    const provider = makeProvider({ pushEvents: () => Promise.resolve([{ success: true, remoteId: "remote-1" }]) });

    const outcome = await executeRemoteOperations(operations, [], "dest-cal-1", provider);


    expect(outcome.changes.inserts[0]?.deleteIdentifier).toBe("remote-1");
  });

  it("uses explicit deleteId from pushResult when provided", async () => {
    const event = makeEvent("ev-1", new Date("2026-03-15T09:00:00Z"), new Date("2026-03-15T10:00:00Z"));
    const operations: SyncOperation[] = [{ type: "add", event }];
    const provider = makeProvider({ pushEvents: () => Promise.resolve([{ success: true, remoteId: "remote-1", deleteId: "delete-key-1" }]) });

    const outcome = await executeRemoteOperations(operations, [], "dest-cal-1", provider);


    expect(outcome.changes.inserts[0]?.deleteIdentifier).toBe("delete-key-1");
  });

  it("returns empty result for zero operations", async () => {
    const provider = makeProvider();

    const outcome = await executeRemoteOperations([], [], "dest-cal-1", provider);


    expect(outcome.result.added).toBe(0);
    expect(outcome.result.removed).toBe(0);
    expect(outcome.changes.inserts).toHaveLength(0);
    expect(outcome.changes.deletes).toHaveLength(0);
  });

  it("still pushes adds but marks superseded when generation is stale", async () => {
    const event1 = makeEvent("ev-1", new Date("2026-03-15T09:00:00Z"), new Date("2026-03-15T10:00:00Z"));
    const operations: SyncOperation[] = [{ type: "add", event: event1 }];

    let pushCount = 0;
    const provider = makeProvider({
      pushEvents: () => {
        pushCount += 1;
        return Promise.resolve([{ success: true, remoteId: "remote-1" }]);
      },
    });

    const outcome = await executeRemoteOperations(operations, [], "dest-cal-1", provider, () => Promise.resolve(false));

    expect(outcome.superseded).toBe(true);
    expect(pushCount).toBe(1);
    expect(outcome.changes.inserts).toHaveLength(1);
  });

  it("checkpoints removals before adds and skips adds when superseded", async () => {
    const event1 = makeEvent("ev-1", new Date("2026-03-15T09:00:00Z"), new Date("2026-03-15T10:00:00Z"));
    const mapping = makeMapping("map-1", "ev-1", "remote-1");
    const operations: SyncOperation[] = [
      { type: "add", event: event1 },
      { type: "remove", uid: "remote-1", deleteId: "remote-1", startTime: new Date("2026-03-15T09:00:00Z") },
    ];

    let deleteCount = 0;
    const provider = makeProvider({
      pushEvents: () => Promise.resolve([{ success: true, remoteId: "remote-new" }]),
      deleteEvents: () => {
        deleteCount += 1;
        return Promise.resolve([{ success: true }]);
      },
    });

    const outcome = await executeRemoteOperations(operations, [mapping], "dest-cal-1", provider, () => Promise.resolve(false));

    expect(outcome.superseded).toBe(true);
    expect(outcome.changes.inserts).toHaveLength(0);
    expect(outcome.changes.deletes).toEqual([mapping.id]);
    expect(deleteCount).toBe(1);
  });

  it("finishes a replacement before observing that the generation is stale", async () => {
    const event = makeEvent("ev-1", new Date("2026-03-15T11:00:00Z"), new Date("2026-03-15T12:00:00Z"));
    const mapping = makeMapping("map-1", "ev-1", "remote-1");
    const operations: SyncOperation[] = [{
      deleteId: "remote-1",
      event,
      staleMappingId: mapping.id,
      type: "replace",
      uid: "remote-1",
    }];
    const calls: string[] = [];
    const provider = makeProvider({
      deleteEvents: () => {
        calls.push("delete");
        return Promise.resolve([{ success: true }]);
      },
      pushEvents: () => {
        calls.push("add");
        return Promise.resolve([{ remoteId: "remote-new", success: true }]);
      },
    });

    const outcome = await executeRemoteOperations(
      operations,
      [mapping],
      "dest-cal-1",
      provider,
      () => {
        calls.push("current");
        return Promise.resolve(false);
      },
    );

    expect(calls).toEqual(["delete", "add", "current"]);
    expect(outcome.superseded).toBe(true);
    expect(outcome.changes.deletes).toEqual([mapping.id]);
    expect(outcome.changes.inserts).toHaveLength(1);
  });

  it("keeps the stale mapping when recreation fails after a successful delete", async () => {
    const event = makeEvent("ev-1", new Date("2026-03-15T11:00:00Z"), new Date("2026-03-15T12:00:00Z"));
    const mapping = makeMapping("map-1", "ev-1", "remote-1");
    const operations: SyncOperation[] = [{
      deleteId: "remote-1",
      event,
      staleMappingId: mapping.id,
      type: "replace",
      uid: "remote-1",
    }];
    const provider = makeProvider({
      deleteEvents: () => Promise.resolve([{ success: true }]),
      pushEvents: () => Promise.resolve([{ error: "provider unavailable", success: false }]),
    });
    const checkpoints: PendingChanges[] = [];
    let progressUpdates = 0;

    const outcome = await executeRemoteOperations(
      operations,
      [mapping],
      "dest-cal-1",
      provider,
      () => Promise.resolve(true),
      () => { progressUpdates += 1; },
      (changes) => {
        checkpoints.push(changes);
        return Promise.resolve(true);
      },
    );

    expect(outcome.result.removed).toBe(1);
    expect(outcome.result.addFailed).toBe(1);
    expect(outcome.changes.deletes).toHaveLength(0);
    expect(outcome.changes.inserts).toHaveLength(0);
    expect(checkpoints).toHaveLength(0);
    expect(progressUpdates).toBe(1);
  });

  it("does not checkpoint the stale mapping when recreation aborts after deletion", async () => {
    const event = makeEvent("ev-1", new Date("2026-03-15T11:00:00Z"), new Date("2026-03-15T12:00:00Z"));
    const mapping = makeMapping("map-1", "ev-1", "remote-1");
    const operations: SyncOperation[] = [{
      deleteId: "remote-1",
      event,
      staleMappingId: mapping.id,
      type: "replace",
      uid: "remote-1",
    }];
    const abortError = new Error("job deadline exceeded");
    abortError.name = "AbortError";
    const provider = makeProvider({
      deleteEvents: () => Promise.resolve([{ success: true }]),
      pushEvents: () => Promise.reject(abortError),
    });
    const checkpoints: PendingChanges[] = [];

    await expect(executeRemoteOperations(
      operations,
      [mapping],
      "dest-cal-1",
      provider,
      () => Promise.resolve(true),
      (processed, total) => { expect(processed).toBeLessThanOrEqual(total); },
      (changes) => {
        checkpoints.push(changes);
        return Promise.resolve(true);
      },
    )).rejects.toBe(abortError);

    expect(checkpoints).toHaveLength(0);
  });

  it("processes all operations when generation stays current", async () => {
    const event1 = makeEvent("ev-1", new Date("2026-03-15T09:00:00Z"), new Date("2026-03-15T10:00:00Z"));
    const event2 = makeEvent("ev-2", new Date("2026-03-16T09:00:00Z"), new Date("2026-03-16T10:00:00Z"));
    const operations: SyncOperation[] = [{ type: "add", event: event1 }, { type: "add", event: event2 }];
    const provider = makeProvider({
      pushEvents: (events) => Promise.resolve(events.map((_ev, idx) => ({ success: true, remoteId: `remote-${idx}` }))),
    });

    const outcome = await executeRemoteOperations(operations, [], "dest-cal-1", provider, () => Promise.resolve(true));


    expect(outcome.result.added).toBe(2);
    expect(outcome.changes.inserts).toHaveLength(2);
  });
});

describe("syncCalendar", () => {
  it("does not call providers or flush reconciliation state when local materialization fails", async () => {
    const { syncCalendar } = await import("../../../src/core/sync-engine/index");
    const materializationError = new RecurrenceMaterializationLimitError({
      calendarId: "source-calendar-id",
      eventId: "event-state-id",
      eventStateId: "event-state-id",
      sourceEventUid: "pathological-series",
    }, 10_000);
    let providerCalled = false;
    let flushed = false;
    const provider = makeProvider({
      deleteEvents: () => {
        providerCalled = true;
        return Promise.resolve([]);
      },
      listRemoteEvents: () => {
        providerCalled = true;
        return Promise.resolve([]);
      },
      pushEvents: () => {
        providerCalled = true;
        return Promise.resolve([]);
      },
    });

    await expect(syncCalendar({
      userId: "user-1",
      calendarId: "dest-cal-1",
      provider,
      readState: () => Promise.reject(materializationError),
      isCurrent: () => Promise.resolve(true),
      flush: () => {
        flushed = true;
        return Promise.resolve();
      },
    })).rejects.toBe(materializationError);

    expect(providerCalled).toBe(false);
    expect(flushed).toBe(false);
  });

  it("uses a stable weighted progress total for replacements", async () => {
    const { syncCalendar } = await import("../../../src/core/sync-engine/index");
    const previousEvent = makeEvent("ev-1", new Date("2026-03-15T09:00:00Z"), new Date("2026-03-15T10:00:00Z"));
    const movedEvent = makeEvent("ev-1", new Date("2026-03-15T11:00:00Z"), new Date("2026-03-15T12:00:00Z"));
    const mapping = {
      ...makeMapping("map-1", "ev-1", "remote-1"),
      syncEventHash: createSyncEventContentHash(previousEvent),
    };
    const provider = makeProvider({
      deleteEvents: () => Promise.resolve([{ success: true }]),
      pushEvents: () => Promise.resolve([{ remoteId: "remote-new", success: true }]),
    });
    const progressTotals: number[] = [];

    await syncCalendar({
      userId: "user-1",
      calendarId: "dest-cal-1",
      provider,
      readState: () => Promise.resolve({
        localEvents: [movedEvent],
        existingMappings: [mapping],
        remoteEvents: [{
          deleteId: "remote-1",
          endTime: previousEvent.endTime,
          isKeeperEvent: true,
          startTime: previousEvent.startTime,
          uid: "remote-1",
        }],
      }),
      isCurrent: () => Promise.resolve(true),
      flush: () => Promise.resolve(),
      onProgress: (update) => {
        if (update.stage === "processing" && update.progress) {
          progressTotals.push(update.progress.total);
        }
      },
    });

    expect(progressTotals).toEqual([2, 2]);
  });

  it("pushes new events and flushes accumulated changes at the end", async () => {
    const { syncCalendar } = await import("../../../src/core/sync-engine/index");
    const localEvent = makeEvent("ev-1", new Date("2026-03-15T09:00:00Z"), new Date("2026-03-15T10:00:00Z"));
    const provider = makeProvider({ pushEvents: () => Promise.resolve([{ success: true, remoteId: "remote-1" }]) });

    const flushCapture: PendingChanges[] = [];

    const result = await syncCalendar({
      userId: "user-1",
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

  it("flushes partial changes even when superseded after remote operations", async () => {
    const { syncCalendar } = await import("../../../src/core/sync-engine/index");
    const localEvent = makeEvent("ev-1", new Date("2026-03-15T09:00:00Z"), new Date("2026-03-15T10:00:00Z"));
    const provider = makeProvider({ pushEvents: () => Promise.resolve([{ success: true, remoteId: "remote-1" }]) });

    let flushCalled = false;
    let checkCount = 0;

    const result = await syncCalendar({
      userId: "user-1",
      calendarId: "dest-cal-1",
      provider,
      readState: () => Promise.resolve({ localEvents: [localEvent], existingMappings: [], remoteEvents: [] }),
      isCurrent: () => { checkCount += 1; return Promise.resolve(checkCount <= 1); },
      flush: () => { flushCalled = true; return Promise.resolve(); },
    });

    expect(result.added).toBe(1);
    expect(flushCalled).toBe(true);
  });

  it("checkpoints a successful chunk before a later chunk fails", async () => {
    const { syncCalendar } = await import("../../../src/core/sync-engine/index");
    const localEvents = Array.from({ length: 51 }, (_value, index) => makeEvent(
      `ev-${index}`,
      new Date(Date.UTC(2026, 2, 15, 9, index)),
      new Date(Date.UTC(2026, 2, 15, 10, index)),
    ));
    let pushCount = 0;
    const provider = makeProvider({
      pushEvents: (events) => {
        pushCount += 1;
        if (pushCount === 2) {
          return Promise.reject(new Error("provider stopped responding"));
        }
        return Promise.resolve(events.map((event) => ({ success: true, remoteId: `remote-${event.id}` })));
      },
    });
    const checkpoints: PendingChanges[] = [];

    await expect(syncCalendar({
      userId: "user-1",
      calendarId: "dest-cal-1",
      provider,
      readState: () => Promise.resolve({ localEvents, existingMappings: [], remoteEvents: [] }),
      isCurrent: () => Promise.resolve(true),
      flush: (changes) => {
        checkpoints.push(changes);
        return Promise.resolve();
      },
    })).rejects.toThrow("provider stopped responding");

    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]?.inserts).toHaveLength(50);
  });

  it("returns empty result when there are no operations", async () => {
    const { syncCalendar } = await import("../../../src/core/sync-engine/index");
    const provider = makeProvider();
    let flushCalled = false;

    const result = await syncCalendar({
      userId: "user-1",
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

  it("flushes a recurring mapping identity migration without remote writes", async () => {
    const { syncCalendar } = await import("../../../src/core/sync-engine/index");
    const occurrence = {
      ...makeEvent(
        "materialized-occurrence-id",
        new Date("2026-03-15T09:00:00Z"),
        new Date("2026-03-15T10:00:00Z"),
      ),
      eventStateId: "recurring-master-id",
    };
    const mapping = {
      ...makeMapping("map-1", "recurring-master-id", "legacy-occurrence@keeper.sh"),
      syncEventHash: "legacy-master-hash",
      syncEventId: "recurring-master-id",
    };
    let deleteCalled = false;
    let pushCalled = false;
    const provider = makeProvider({
      deleteEvents: () => {
        deleteCalled = true;
        return Promise.resolve([]);
      },
      pushEvents: () => {
        pushCalled = true;
        return Promise.resolve([]);
      },
    });
    const flushes: PendingChanges[] = [];

    const result = await syncCalendar({
      userId: "user-1",
      calendarId: "dest-cal-1",
      provider,
      readState: () => Promise.resolve({
        localEvents: [occurrence],
        existingMappings: [mapping],
        remoteEvents: [{
          deleteId: "google-provider-occurrence-id",
          editableAvailability: "busy",
          editableContentHash: createEditableEventContentHash(occurrence),
          endTime: occurrence.endTime,
          isKeeperEvent: true,
          startTime: occurrence.startTime,
          uid: mapping.destinationEventUid,
        }],
      }),
      isCurrent: () => Promise.resolve(true),
      flush: (changes) => {
        flushes.push(changes);
        return Promise.resolve();
      },
    });

    expect(result).toMatchObject({ added: 0, removed: 0 });
    expect(deleteCalled).toBe(false);
    expect(pushCalled).toBe(false);
    expect(flushes).toEqual([{
      deletes: [],
      inserts: [],
      updates: [{
        deleteIdentifier: "google-provider-occurrence-id",
        id: mapping.id,
        syncEventHash: createSyncEventContentHash(occurrence),
        syncEventId: occurrence.id,
      }],
    }]);
  });

  it("emits a wide event with sync context when onSyncEvent is provided", async () => {
    const { syncCalendar } = await import("../../../src/core/sync-engine/index");
    const localEvent = makeEvent("ev-1", new Date("2026-03-15T09:00:00Z"), new Date("2026-03-15T10:00:00Z"));
    const provider = makeProvider({ pushEvents: () => Promise.resolve([{ success: true, remoteId: "remote-1" }]) });

    const emittedEvents: Record<string, unknown>[] = [];

    await syncCalendar({
      userId: "user-1",
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

  it("emits only nonzero stale mapping reason counts", async () => {
    const { syncCalendar } = await import("../../../src/core/sync-engine/index");
    const localEvent = makeEvent(
      "ev-1",
      new Date("2026-03-15T09:00:00Z"),
      new Date("2026-03-15T10:00:00Z"),
    );
    const mapping = {
      ...makeMapping("map-1", localEvent.id, "remote-1"),
      syncEventHash: createSyncEventContentHash(localEvent),
    };
    const provider = makeProvider({
      deleteEvents: () => Promise.resolve([{ success: true }]),
      pushEvents: () => Promise.resolve([{ remoteId: "remote-new", success: true }]),
    });
    const emittedEvents: Record<string, unknown>[] = [];

    await syncCalendar({
      userId: "user-1",
      calendarId: "dest-cal-1",
      provider,
      readState: () => Promise.resolve({
        localEvents: [localEvent],
        existingMappings: [mapping],
        remoteEvents: [{
          deleteId: "remote-1",
          editableContentHash: createEditableEventContentHash({
            ...localEvent,
            summary: "Edited remotely",
          }),
          endTime: localEvent.endTime,
          isKeeperEvent: true,
          startTime: localEvent.startTime,
          uid: "remote-1",
        }],
      }),
      isCurrent: () => Promise.resolve(true),
      flush: () => Promise.resolve(),
      onSyncEvent: (event) => { emittedEvents.push(event); },
    });

    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0]).toMatchObject({
      "stale_mappings.count": 1,
      "stale_mappings.remote_content_changed_count": 1,
    });
    expect(emittedEvents[0]).not.toHaveProperty(
      "stale_mappings.local_hash_changed_count",
    );
    expect(emittedEvents[0]).not.toHaveProperty(
      "stale_mappings.remote_time_changed_count",
    );
  });

  it("emits a wide event with outcome superseded but flushed when generation becomes stale", async () => {
    const { syncCalendar } = await import("../../../src/core/sync-engine/index");
    const localEvent = makeEvent("ev-1", new Date("2026-03-15T09:00:00Z"), new Date("2026-03-15T10:00:00Z"));
    const provider = makeProvider({ pushEvents: () => Promise.resolve([{ success: true, remoteId: "remote-1" }]) });

    const emittedEvents: Record<string, unknown>[] = [];
    let checkCount = 0;

    await syncCalendar({
      userId: "user-1",
      calendarId: "dest-cal-1",
      provider,
      readState: () => Promise.resolve({ localEvents: [localEvent], existingMappings: [], remoteEvents: [] }),
      isCurrent: () => { checkCount += 1; return Promise.resolve(checkCount <= 1); },
      flush: () => Promise.resolve(),
      onSyncEvent: (event) => { emittedEvents.push(event); },
    });

    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0]?.["outcome"]).toBe("superseded");
    expect(emittedEvents[0]?.["flushed"]).toBe(true);
  });

  it("emits a wide event with outcome in-sync when there are no operations", async () => {
    const { syncCalendar } = await import("../../../src/core/sync-engine/index");
    const provider = makeProvider();

    const emittedEvents: Record<string, unknown>[] = [];

    await syncCalendar({
      userId: "user-1",
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
    const { syncCalendar } = await import("../../../src/core/sync-engine/index");
    const provider = makeProvider();

    const emittedEvents: Record<string, unknown>[] = [];

    try {
      await syncCalendar({
        userId: "user-1",
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

  it("emits the underlying PostgreSQL error details when a database query throws", async () => {
    const { syncCalendar } = await import("../../../src/core/sync-engine/index");
    const provider = makeProvider();
    const emittedEvents: Record<string, unknown>[] = [];
    const cause = Object.assign(new Error("duplicate key value violates unique constraint"), {
      constraint: "event_mappings_sync_event_cal_idx",
      detail: "Key already exists.",
      errno: "23505",
    });
    const error = new Error("Failed query", { cause });

    await expect(syncCalendar({
      userId: "user-1",
      calendarId: "dest-cal-1",
      provider,
      readState: () => Promise.reject(error),
      isCurrent: () => Promise.resolve(true),
      flush: () => Promise.resolve(),
      onSyncEvent: (event) => { emittedEvents.push(event); },
    })).rejects.toThrow("Failed query");

    expect(emittedEvents[0]).toMatchObject({
      "error.database.constraint": "event_mappings_sync_event_cal_idx",
      "error.database.detail": "Key already exists.",
      "error.database.message": "duplicate key value violates unique constraint",
      "error.database.sqlstate": "23505",
      "error.message": "Failed query",
      outcome: "error",
    });
  });
});

describe("createRedisGenerationCheck", () => {
  it("returns true when the generation counter has not been incremented", async () => {
    const { createRedisGenerationCheck } = await import("../../../src/core/sync-engine/generation");
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
    const { createRedisGenerationCheck } = await import("../../../src/core/sync-engine/generation");
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
    const { createRedisGenerationCheck, GENERATION_TTL_SECONDS } = await import("../../../src/core/sync-engine/generation");
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
  it("batches inserts, deletes, and mapping updates into a single transaction", async () => {
    const { createDatabaseFlush } = await import("../../../src/core/sync-engine/flush");
    const executedOperations: string[] = [];

    const fakeDatabase = {
      transaction: (callback: (tx: unknown) => Promise<void>) => {
        const tx = {
          update: () => ({
            set: () => {
              executedOperations.push("update");
              return { where: () => Promise.resolve() };
            },
          }),
          insert: () => { executedOperations.push("insert"); return { values: () => ({ onConflictDoNothing: () => Promise.resolve() }) }; },
          delete: () => { executedOperations.push("delete"); return { where: () => Promise.resolve() }; },
        };
        return callback(tx);
      },
    };

    const flush = createDatabaseFlush(fakeDatabase as never);
    await flush({
      inserts: [{
        eventStateId: "ev-1", calendarId: "cal-1", destinationEventUid: "remote-1",
        syncEventId: "ev-1",
        deleteIdentifier: "remote-1", syncEventHash: null,
        startTime: new Date("2026-03-15T09:00:00Z"), endTime: new Date("2026-03-15T10:00:00Z"),
      }],
      deletes: ["map-1", "map-2"],
      updates: [{
        deleteIdentifier: "google-provider-occurrence-id",
        id: "019c0000-0000-7000-8000-000000000001",
        syncEventHash: "occurrence-hash",
        syncEventId: "materialized-occurrence-id",
      }],
    });

    expect(executedOperations).toEqual(["delete", "insert", "update"]);
  });

  it("updates every mapping through the typed update builder", async () => {
    const { createDatabaseFlush } = await import("../../../src/core/sync-engine/flush");
    const updateValues: unknown[] = [];
    let whereCallCount = 0;
    const fakeDatabase = {
      transaction: (callback: (tx: unknown) => Promise<void>) => callback({
        update: () => ({
          set: (values: unknown) => {
            updateValues.push(values);
            return {
              where: () => {
                whereCallCount += 1;
                return Promise.resolve();
              },
            };
          },
        }),
      }),
    };

    const flush = createDatabaseFlush(fakeDatabase as never);
    await flush({
      deletes: [],
      inserts: [],
      updates: [
        {
          deleteIdentifier: "remote-delete-1",
          id: "019c0000-0000-7000-8000-000000000001",
          syncEventHash: "hash-1",
          syncEventId: "recurrence-1",
        },
        {
          deleteIdentifier: "remote-delete-2",
          id: "019c0000-0000-7000-8000-000000000002",
          syncEventHash: "hash-2",
          syncEventId: "recurrence-2",
        },
      ],
    });

    expect(updateValues).toEqual([
      {
        deleteIdentifier: "remote-delete-1",
        syncEventHash: "hash-1",
        syncEventId: "recurrence-1",
      },
      {
        deleteIdentifier: "remote-delete-2",
        syncEventHash: "hash-2",
        syncEventId: "recurrence-2",
      },
    ]);
    expect(whereCallCount).toBe(2);
  });

  it("skips delete when there are no deletes", async () => {
    const { createDatabaseFlush } = await import("../../../src/core/sync-engine/flush");
    const executedOperations: string[] = [];
    const fakeDatabase = {
      transaction: (callback: (tx: unknown) => Promise<void>) => {
        const tx = {
          insert: () => { executedOperations.push("insert"); return { values: () => ({ onConflictDoNothing: () => Promise.resolve() }) }; },
          delete: () => { executedOperations.push("delete"); return { where: () => Promise.resolve() }; },
        };
        return callback(tx);
      },
    };

    const flush = createDatabaseFlush(fakeDatabase as never);
    await flush({
      inserts: [{
        eventStateId: "ev-1", calendarId: "cal-1", destinationEventUid: "remote-1",
        syncEventId: "ev-1",
        deleteIdentifier: "remote-1", syncEventHash: null,
        startTime: new Date("2026-03-15T09:00:00Z"), endTime: new Date("2026-03-15T10:00:00Z"),
      }],
      deletes: [],
    });

    expect(executedOperations).toEqual(["insert"]);
  });

  it("skips insert when there are no inserts", async () => {
    const { createDatabaseFlush } = await import("../../../src/core/sync-engine/flush");
    const executedOperations: string[] = [];
    const fakeDatabase = {
      transaction: (callback: (tx: unknown) => Promise<void>) => {
        const tx = {
          insert: () => { executedOperations.push("insert"); return { values: () => ({ onConflictDoNothing: () => Promise.resolve() }) }; },
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
    const { createDatabaseFlush } = await import("../../../src/core/sync-engine/flush");
    let transactionCalled = false;
    const fakeDatabase = {
      transaction: () => { transactionCalled = true; return Promise.resolve(); },
    };

    const flush = createDatabaseFlush(fakeDatabase as never);
    await flush({ inserts: [], deletes: [] });

    expect(transactionCalled).toBe(false);
  });

  it("chunks deletes into batches to avoid exceeding parameter limits", async () => {
    const { createDatabaseFlush, FLUSH_BATCH_SIZE } = await import("../../../src/core/sync-engine/flush");
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
    const { createDatabaseFlush, FLUSH_BATCH_SIZE } = await import("../../../src/core/sync-engine/flush");
    let insertCallCount = 0;

    const fakeDatabase = {
      transaction: (callback: (tx: unknown) => Promise<void>) => {
        const tx = {
          insert: () => {
            insertCallCount += 1;
            return { values: () => ({ onConflictDoNothing: () => Promise.resolve() }) };
          },
          delete: () => ({ where: () => Promise.resolve() }),
        };
        return callback(tx);
      },
    };

    const inserts = Array.from({ length: FLUSH_BATCH_SIZE + 10 }, (_entry, idx) => ({
      eventStateId: `ev-${idx}`, calendarId: "cal-1", destinationEventUid: `remote-${idx}`,
      syncEventId: `ev-${idx}`,
      deleteIdentifier: `remote-${idx}`, syncEventHash: null,
      startTime: new Date("2026-03-15T09:00:00Z"), endTime: new Date("2026-03-15T10:00:00Z"),
    }));

    const flush = createDatabaseFlush(fakeDatabase as never);
    await flush({ inserts, deletes: [] });

    expect(insertCallCount).toBe(2);
  });

  it("calls insert once for multiple inserts using bulk values", async () => {
    const { createDatabaseFlush } = await import("../../../src/core/sync-engine/flush");
    let insertCallCount = 0;
    let valuesReceived: unknown[] = [];

    const fakeDatabase = {
      transaction: (callback: (tx: unknown) => Promise<void>) => {
        const tx = {
          insert: () => {
            insertCallCount += 1;
            return {
              values: (rows: unknown[]) => { valuesReceived = rows; return { onConflictDoNothing: () => Promise.resolve() }; },
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
          syncEventId: "ev-1",
          deleteIdentifier: "remote-1", syncEventHash: null,
          startTime: new Date("2026-03-15T09:00:00Z"), endTime: new Date("2026-03-15T10:00:00Z"),
        },
        {
          eventStateId: "ev-2", calendarId: "cal-1", destinationEventUid: "remote-2",
          syncEventId: "ev-2",
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
