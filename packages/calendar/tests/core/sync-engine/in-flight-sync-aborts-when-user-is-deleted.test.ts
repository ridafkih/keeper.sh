import { describe, expect, it } from "vitest";
import { syncCalendar } from "../../../src/core/sync-engine/index";
import type { SyncCalendarOptions } from "../../../src/core/sync-engine/index";
import type {
  DeleteResult,
  MaterializedSyncableEvent,
  PushResult,
  RemoteEvent,
} from "../../../src/core/types";
import type { EventMapping } from "../../../src/core/events/mappings";

/*
 * Incident 2026-08-25: user qhPedMZJCcAFPcqsdHGo5m8K5RLacWFx deleted their account at
 * 06:15:33 UTC. At 06:17:40 a sync:calendar job that was already in flight kept writing
 * to their Google calendar and recorded events_removed: 500, outcome: success. Deletion
 * leaves no signal the sync engine can observe, so a running reconcile drives every
 * remaining chunk to completion against a deleted customer's provider account.
 */

const TEST_RECONCILIATION_SCOPE = {
  authoritativeWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
  requestedWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
};

const ADD_COUNT = 120;
const REMOVE_COUNT = 40;
const OPERATION_CHUNK_SIZE = 50;

const makeEvent = (index: number): MaterializedSyncableEvent => {
  const startTime = new Date(Date.UTC(2026, 2, 15, 9, 0, 0) + index * 3_600_000);
  return {
    id: `ev-${index}`,
    sourceEventUid: `uid-ev-${index}`,
    startTime,
    endTime: new Date(startTime.getTime() + 1_800_000),
    summary: `Event ${index}`,
    calendarId: "cal-1",
    calendarName: "Test Calendar",
    calendarUrl: null,
  };
};

const makeDoomedMapping = (index: number): EventMapping => {
  const startTime = new Date(Date.UTC(2027, 5, 1, 9, 0, 0) + index * 3_600_000);
  return {
    id: `map-${index}`,
    eventStateId: `gone-${index}`,
    syncEventId: `gone-${index}`,
    calendarId: "dest-cal-1",
    sourceCalendarId: "cal-1",
    destinationEventUid: `remote-gone-${index}`,
    deleteIdentifier: `remote-gone-${index}`,
    syncEventHash: null,
    startTime,
    endTime: new Date(startTime.getTime() + 1_800_000),
  };
};

const makeDoomedRemoteEvent = (mapping: EventMapping): RemoteEvent => ({
  deleteId: mapping.deleteIdentifier,
  endTime: mapping.endTime,
  isKeeperEvent: true,
  startTime: mapping.startTime,
  uid: mapping.destinationEventUid,
});

interface ProviderWrite {
  ids: string[];
  type: "push" | "delete";
}

type DeletionAwareSyncCalendarOptions = SyncCalendarOptions & {
  isUserDeleted: () => Promise<boolean>;
};

describe("in-flight sync aborts when the user is deleted", () => {
  it("stops writing to the provider once the deletion tombstone appears mid-run", async () => {
    const localEvents = Array.from({ length: ADD_COUNT }, (_value, index) => makeEvent(index));
    const existingMappings = Array.from({ length: REMOVE_COUNT }, (_value, index) =>
      makeDoomedMapping(index));
    const remoteEvents = existingMappings.map((mapping) => makeDoomedRemoteEvent(mapping));

    const writes: ProviderWrite[] = [];
    let userDeleted = false;

    const provider = {
      deleteEvents: (eventIds: string[]): Promise<DeleteResult[]> => {
        writes.push({ ids: [...eventIds], type: "delete" });
        return Promise.resolve(eventIds.map(() => ({ success: true })));
      },
      listRemoteEvents: (): Promise<RemoteEvent[]> => Promise.resolve(remoteEvents),
      pushEvents: (events: MaterializedSyncableEvent[]): Promise<PushResult[]> => {
        writes.push({ ids: events.map((event) => event.id), type: "push" });
        userDeleted = true;
        return Promise.resolve(events.map((event) => ({
          deleteId: `remote-${event.id}`,
          remoteId: `remote-${event.id}`,
          success: true,
        })));
      },
    };

    const emitted: Record<string, unknown>[] = [];

    const options: DeletionAwareSyncCalendarOptions = {
      calendarId: "dest-cal-1",
      flush: () => Promise.resolve(),
      isCurrent: () => Promise.resolve(true),
      isUserDeleted: () => Promise.resolve(userDeleted),
      onSyncEvent: (event) => {
        emitted.push(event);
      },
      provider,
      readState: () => Promise.resolve({ existingMappings, localEvents, remoteEvents }),
      reconciliationScope: TEST_RECONCILIATION_SCOPE,
      userId: "user-1",
    };

    const result = await syncCalendar(options);

    const pushedIds = writes.filter((write) => write.type === "push").flatMap((write) => write.ids);
    const deletedIds = writes.filter((write) => write.type === "delete").flatMap((write) => write.ids);

    expect(writes.map((write) => write.type)).toEqual(["push"]);
    expect(pushedIds).toHaveLength(OPERATION_CHUNK_SIZE);
    expect(deletedIds).toEqual([]);
    expect(result.removed).toBe(0);

    expect(emitted).toHaveLength(1);
    const [wideEvent] = emitted;
    expect(wideEvent?.["outcome"]).toBe("aborted");
    expect(wideEvent?.["events.removed"]).toBe(0);
  });
});
