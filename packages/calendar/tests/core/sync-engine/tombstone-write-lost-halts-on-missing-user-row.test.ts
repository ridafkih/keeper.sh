import { describe, expect, it } from "vitest";
import { createUserDeletedCheck } from "../../../src/core/utils/deleted-user-tombstone";
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
const REMOVE_COUNT = 40;
const OPERATION_CHUNK_SIZE = 50;
const USER_ID = "user-1";

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

const makeDoomedMapping = (index: number): EventMapping => {
  const startTime = new Date(Date.UTC(2027, 5, 1, 9, 0, 0) + index * 3_600_000);
  return {
    calendarId: "dest-cal-1",
    deleteIdentifier: `remote-gone-${index}`,
    destinationEventUid: `remote-gone-${index}`,
    endTime: new Date(startTime.getTime() + 1_800_000),
    eventStateId: `gone-${index}`,
    id: `map-${index}`,
    sourceCalendarId: "cal-1",
    startTime,
    syncEventHash: null,
    syncEventId: `gone-${index}`,
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

interface Scenario {
  emitted: Record<string, unknown>[];
  existsCalls: number;
  run: () => Promise<Awaited<ReturnType<typeof syncCalendar>>>;
  userRowLookups: number;
  writes: ProviderWrite[];
}

interface ScenarioOptions {
  existsResult: () => Promise<number>;
  userRowPresent: () => Promise<boolean>;
}

const makeScenario = (options: ScenarioOptions): Scenario => {
  const localEvents = Array.from({ length: ADD_COUNT }, (_value, index) => makeEvent(index));
  const existingMappings = Array.from({ length: REMOVE_COUNT }, (_value, index) =>
    makeDoomedMapping(index));
  const remoteEvents = existingMappings.map((mapping) => makeDoomedRemoteEvent(mapping));

  const writes: ProviderWrite[] = [];
  const emitted: Record<string, unknown>[] = [];
  const counters = { exists: 0, userRow: 0 };

  const provider = {
    deleteEvents: (eventIds: string[]): Promise<DeleteResult[]> => {
      writes.push({ ids: [...eventIds], type: "delete" });
      return Promise.resolve(eventIds.map(() => ({ success: true })));
    },
    listRemoteEvents: (): Promise<RemoteEvent[]> => Promise.resolve(remoteEvents),
    pushEvents: (events: MaterializedSyncableEvent[]): Promise<PushResult[]> => {
      writes.push({ ids: events.map((event) => event.id), type: "push" });
      return Promise.resolve(events.map((event) => ({
        deleteId: `remote-${event.id}`,
        remoteId: `remote-${event.id}`,
        success: true,
      })));
    },
  };

  const redis = {
    exists: (_key: string): Promise<number> => {
      counters.exists += 1;
      return options.existsResult();
    },
  };

  const isUserDeleted = createUserDeletedCheck(redis, USER_ID, {
    isUserRowPresent: () => {
      counters.userRow += 1;
      return options.userRowPresent();
    },
  });

  const syncOptions: DeletionAwareSyncCalendarOptions = {
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
    userId: USER_ID,
  };

  return {
    emitted,
    get existsCalls() {
      return counters.exists;
    },
    run: () => syncCalendar(syncOptions),
    get userRowLookups() {
      return counters.userRow;
    },
    writes,
  };
};

const deletedIdsOf = (writes: ProviderWrite[]): string[] =>
  writes.filter((write) => write.type === "delete").flatMap((write) => write.ids);

describe("a lost tombstone write falls back to the user row", () => {
  it("halts the run when redis has no tombstone but the user row is confirmed gone", async () => {
    const scenario = makeScenario({
      existsResult: () => Promise.resolve(0),
      userRowPresent: () => Promise.resolve(false),
    });

    const result = await scenario.run();

    expect(scenario.userRowLookups).toBeGreaterThan(0);
    expect(result.aborted).toBe(true);
    expect(result.removed).toBe(0);
    expect(deletedIdsOf(scenario.writes)).toEqual([]);
    expect(scenario.writes.filter((write) => write.type === "push")).toHaveLength(0);
    expect(scenario.emitted.at(0)?.["outcome"]).toBe("aborted");
  });

  it("leaves a live customer's run alone when the user row lookup fails", async () => {
    const scenario = makeScenario({
      existsResult: () => Promise.resolve(0),
      userRowPresent: () => Promise.reject(new Error("database connection terminated")),
    });

    const result = await scenario.run();

    expect(result.aborted).toBeFalsy();
    expect(result.removed).toBe(REMOVE_COUNT);
    expect(deletedIdsOf(scenario.writes)).toHaveLength(REMOVE_COUNT);
    expect(scenario.writes.filter((write) => write.type === "push").flatMap((write) => write.ids))
      .toHaveLength(ADD_COUNT);
  });

  it("leaves a live customer's run alone when redis fails and the user row is present", async () => {
    const scenario = makeScenario({
      existsResult: () => Promise.reject(new Error("OOM command not allowed when used memory > 'maxmemory'.")),
      userRowPresent: () => Promise.resolve(true),
    });

    const result = await scenario.run();

    expect(scenario.existsCalls).toBeGreaterThan(0);
    expect(result.aborted).toBeFalsy();
    expect(result.removed).toBe(REMOVE_COUNT);
    expect(deletedIdsOf(scenario.writes)).toHaveLength(REMOVE_COUNT);
  });
});

describe("chunk sizing assumption", () => {
  it("keeps the first push chunk at the engine's operation chunk size", async () => {
    const scenario = makeScenario({
      existsResult: () => Promise.resolve(0),
      userRowPresent: () => Promise.resolve(true),
    });

    await scenario.run();

    expect(scenario.writes.at(0)?.ids).toHaveLength(OPERATION_CHUNK_SIZE);
  });
});
