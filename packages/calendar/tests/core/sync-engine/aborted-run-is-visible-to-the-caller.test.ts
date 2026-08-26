import { describe, expect, it } from "vitest";
import { syncCalendar } from "../../../src/core/sync-engine/index";
import type { SyncCalendarOptions } from "../../../src/core/sync-engine/index";
import type {
  DeleteResult,
  MaterializedSyncableEvent,
  PushResult,
  RemoteEvent,
} from "../../../src/core/types";

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

const makeEvent = (index: number): MaterializedSyncableEvent => {
  const startTime = new Date(Date.UTC(2026, 2, 15, 9, 0, 0) + index * 3_600_000);
  return {
    calendarId: "cal-1",
    calendarName: "Test Calendar",
    calendarUrl: null,
    endTime: new Date(startTime.getTime() + 1_800_000),
    id: `ev-${index}`,
    sourceEventUid: `uid-ev-${index}`,
    startTime,
    summary: `Event ${index}`,
  };
};

type DeletionAwareSyncCalendarOptions = SyncCalendarOptions & {
  isUserDeleted: () => Promise<boolean>;
};

describe("a run aborted by the deletion tombstone", () => {
  it("hands the caller a result that is distinguishable from a clean success", async () => {
    const localEvents = Array.from({ length: 60 }, (_value, index) => makeEvent(index));
    const flushes: unknown[] = [];
    const emitted: Record<string, unknown>[] = [];
    const writes: string[] = [];

    const provider = {
      deleteEvents: (eventIds: string[]): Promise<DeleteResult[]> => {
        writes.push(...eventIds);
        return Promise.resolve(eventIds.map(() => ({ success: true })));
      },
      listRemoteEvents: (): Promise<RemoteEvent[]> => Promise.resolve([]),
      pushEvents: (events: MaterializedSyncableEvent[]): Promise<PushResult[]> => {
        writes.push(...events.map((event) => event.id));
        return Promise.resolve(events.map((event) => ({
          deleteId: `remote-${event.id}`,
          remoteId: `remote-${event.id}`,
          success: true,
        })));
      },
    };

    const options: DeletionAwareSyncCalendarOptions = {
      calendarId: "dest-cal-1",
      flush: (changes) => {
        flushes.push(changes);
        return Promise.resolve();
      },
      isCurrent: () => Promise.resolve(true),
      isUserDeleted: () => Promise.resolve(true),
      onSyncEvent: (event) => {
        emitted.push(event);
      },
      provider,
      readState: () => Promise.resolve({ existingMappings: [], localEvents, remoteEvents: [] }),
      reconciliationScope: TEST_RECONCILIATION_SCOPE,
      userId: "user-1",
    };

    const result = await syncCalendar(options);

    expect(writes).toEqual([]);
    expect(flushes).toEqual([]);
    expect(result).toEqual({
      aborted: true,
      added: 0,
      addFailed: 0,
      conflictsResolved: 0,
      errors: [],
      removed: 0,
      removeFailed: 0,
    });

    const [wideEvent] = emitted;
    expect(wideEvent?.["outcome"]).toBe("aborted");
    expect(wideEvent?.["aborted"]).toBe(true);
    expect(wideEvent?.["flushed"]).toBe(false);
  });
});
