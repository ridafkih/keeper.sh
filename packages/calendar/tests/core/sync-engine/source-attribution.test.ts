import { describe, expect, it } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import type { EventMapping } from "../../../src/core/events/mappings";
import type { MaterializedSyncableEvent, PushResult, SyncOperation } from "../../../src/core/types";
import type { EventUpdate } from "../../../src/core/sync-engine/types";

const WINDOW = {
  timeMax: new Date("2027-03-01T00:00:00.000Z"),
  timeMin: new Date("2026-02-01T00:00:00.000Z"),
};

const event = (id: string, calendarId: string, start = "2026-03-15T09:00:00.000Z"): MaterializedSyncableEvent => ({
  calendarId,
  calendarName: calendarId,
  calendarUrl: null,
  endTime: new Date(new Date(start).getTime() + 60 * 60 * 1000),
  id,
  sourceEventUid: `uid-${id}`,
  startTime: new Date(start),
  summary: id,
});

const mapping = (id: string, sourceCalendarId: string, start = "2026-03-15T09:00:00.000Z"): EventMapping => ({
  calendarId: "family",
  deleteIdentifier: `remote-${id}`,
  destinationEventUid: `remote-${id}`,
  endTime: new Date(new Date(start).getTime() + 60 * 60 * 1000),
  eventStateId: id,
  id,
  sourceCalendarId,
  startTime: new Date(start),
  syncEventHash: null,
  syncEventId: id,
});

const remove = (target: EventMapping): SyncOperation => ({
  deleteId: target.deleteIdentifier,
  mappingId: target.id,
  startTime: target.startTime,
  type: "remove",
  uid: target.destinationEventUid,
});

const replace = (target: EventMapping, replacement: MaterializedSyncableEvent): SyncOperation => ({
  deleteId: target.deleteIdentifier,
  event: replacement,
  staleMappingId: target.id,
  type: "replace",
  uid: target.destinationEventUid,
});

const pushAll = (events: MaterializedSyncableEvent[]): Promise<PushResult[]> =>
  Promise.resolve(events.map((pushed) => ({ remoteId: `remote-${pushed.id}`, success: true })));

const deleteAll = (ids: string[]) => Promise.resolve(ids.map(() => ({ success: true })));

const run = (
  operations: SyncOperation[],
  mappings: EventMapping[],
  provider: Parameters<typeof executeRemoteOperations>[3],
) => executeRemoteOperations(
  operations,
  mappings,
  "family",
  provider,
  () => Promise.resolve(true),
  () => null,
  () => Promise.resolve(true),
  WINDOW,
);

describe("per-source run tallies", () => {
  it("credits adds and removes to the source calendar each copy came from", async () => {
    const schoolCopy = mapping("school-1", "school");
    const outcome = await run(
      [{ event: event("work-1", "work"), type: "add" }, { event: event("work-2", "work"), type: "add" }, remove(schoolCopy)],
      [schoolCopy],
      { deleteEvents: deleteAll, listRemoteEvents: () => Promise.resolve([]), pushEvents: pushAll },
    );

    expect(outcome.sources).toEqual({
      school: { added: 0, failed: 0, removed: 1, updated: 0 },
      work: { added: 2, failed: 0, removed: 0, updated: 0 },
    });
  });

  it("counts a replacement as an update, whether done in place or by delete and re-add", async () => {
    const stale = mapping("work-1", "work");
    const inPlace = await run(
      [replace(stale, event("work-1", "work"))],
      [stale],
      {
        deleteEvents: deleteAll,
        listRemoteEvents: () => Promise.resolve([]),
        pushEvents: pushAll,
        updateEvents: (updates: EventUpdate[]) => Promise.resolve(updates.map(() => ({ success: true }))),
      },
    );
    const deleteThenAdd = await run(
      [replace(stale, event("work-1", "work"))],
      [stale],
      { deleteEvents: deleteAll, listRemoteEvents: () => Promise.resolve([]), pushEvents: pushAll },
    );

    expect(inPlace.sources).toEqual({ work: { added: 0, failed: 0, removed: 0, updated: 1 } });
    expect(deleteThenAdd.sources).toEqual({ work: { added: 0, failed: 0, removed: 0, updated: 1 } });
    expect(deleteThenAdd.result).toEqual({ added: 1, addFailed: 0, removed: 1, removeFailed: 0 });
  });

  it("leaves the moving window's arrivals and departures out of added and removed", async () => {
    const departed = mapping("work-old", "work", "2026-01-10T09:00:00.000Z");
    const outcome = await run(
      [remove(departed), { event: event("work-far", "work", "2027-02-28T12:00:00.000Z"), type: "add" }],
      [departed],
      { deleteEvents: deleteAll, listRemoteEvents: () => Promise.resolve([]), pushEvents: pushAll },
    );

    expect(outcome.result).toMatchObject({ added: 1, removed: 1 });
    expect(outcome.sources).toEqual({});
  });

  it("counts failures against their source and orphaned copies against nobody", async () => {
    const outcome = await run(
      [
        { event: event("work-1", "work"), type: "add" },
        { deleteId: "orphan", startTime: new Date("2026-03-15T09:00:00.000Z"), type: "remove", uid: "orphan" },
      ],
      [],
      {
        deleteEvents: deleteAll,
        listRemoteEvents: () => Promise.resolve([]),
        pushEvents: () => Promise.resolve([{ error: "quota", success: false }]),
      },
    );

    expect(outcome.result).toMatchObject({ addFailed: 1, removed: 1 });
    expect(outcome.sources).toEqual({ work: { added: 0, failed: 1, removed: 0, updated: 0 } });
  });
});
