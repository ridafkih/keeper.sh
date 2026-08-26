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

const runSync = async (
  isUserDeleted: () => Promise<boolean>,
  onPush: () => void,
): Promise<Record<string, unknown>> => {
  const localEvents = Array.from({ length: ADD_COUNT }, (_value, index) => makeEvent(index));
  const existingMappings: EventMapping[] = [];
  const remoteEvents: RemoteEvent[] = [];
  const emitted: Record<string, unknown>[] = [];

  const provider = {
    deleteEvents: (eventIds: string[]): Promise<DeleteResult[]> =>
      Promise.resolve(eventIds.map(() => ({ success: true }))),
    listRemoteEvents: (): Promise<RemoteEvent[]> => Promise.resolve(remoteEvents),
    pushEvents: (events: MaterializedSyncableEvent[]): Promise<PushResult[]> => {
      onPush();
      return Promise.resolve(events.map((event) => ({
        deleteId: `remote-${event.id}`,
        remoteId: `remote-${event.id}`,
        success: true,
      })));
    },
  };

  const options: DeletionAwareSyncCalendarOptions = {
    calendarId: "dest-cal-1",
    flush: () => Promise.resolve(),
    isCurrent: () => Promise.resolve(true),
    isUserDeleted,
    onSyncEvent: (event) => {
      emitted.push(event);
    },
    provider,
    readState: () => Promise.resolve({ existingMappings, localEvents, remoteEvents }),
    reconciliationScope: TEST_RECONCILIATION_SCOPE,
    userId: "user-1",
  };

  await syncCalendar(options);

  const [wideEvent] = emitted;

  if (!wideEvent) {
    throw new TypeError("syncCalendar emitted no wide event");
  }

  return wideEvent;
};

describe("a run halted by the deletion tombstone is alertable", () => {
  it("names the halt on the wide event instead of only recording outcome aborted", async () => {
    let userDeleted = false;

    const wideEvent = await runSync(
      () => Promise.resolve(userDeleted),
      () => {
        userDeleted = true;
      },
    );

    expect(wideEvent["outcome"]).toBe("aborted");
    expect(wideEvent["aborted"]).toBe(true);
    expect(wideEvent["abort.reason"]).toBe("user_deleted");
  });

  it("names the halt even when it fires before any provider write", async () => {
    const wideEvent = await runSync(() => Promise.resolve(true), () => {
      throw new TypeError("halted run must not push events");
    });

    expect(wideEvent["outcome"]).toBe("aborted");
    expect(wideEvent["abort.reason"]).toBe("user_deleted");
  });

  it("leaves a healthy run free of the halt signal", async () => {
    let pushes = 0;
    const wideEvent = await runSync(() => Promise.resolve(false), () => {
      pushes += 1;
    });

    expect(pushes).toBeGreaterThan(0);
    expect(wideEvent["outcome"]).toBe("success");
    expect(wideEvent["aborted"]).toBe(false);
    expect(wideEvent["abort.reason"]).toBeUndefined();
  });
});
