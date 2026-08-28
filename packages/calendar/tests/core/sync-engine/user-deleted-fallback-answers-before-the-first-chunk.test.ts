import { describe, expect, it } from "vitest";
import {
  createUserDeletedCheck,
  deletedUserTombstoneKey,
} from "../../../src/core/utils/deleted-user-tombstone";
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

const REMOVE_COUNT = 500;
const USER_ID = "user-1";

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
  probeErrors: unknown[];
  run: () => Promise<Awaited<ReturnType<typeof syncCalendar>>>;
  userRowLookups: number;
  writes: ProviderWrite[];
}

interface ScenarioOptions {
  existsResult: () => Promise<number>;
  userRowPresent: () => Promise<boolean>;
}

const makeScenario = (options: ScenarioOptions): Scenario => {
  const existingMappings = Array.from({ length: REMOVE_COUNT }, (_value, index) =>
    makeDoomedMapping(index));
  const remoteEvents = existingMappings.map((mapping) => makeDoomedRemoteEvent(mapping));

  const writes: ProviderWrite[] = [];
  const emitted: Record<string, unknown>[] = [];
  const probeErrors: unknown[] = [];
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
    exists: async (key: string): Promise<number> => {
      counters.exists += 1;
      const result = await options.existsResult();
      return key === deletedUserTombstoneKey(USER_ID) ? result : 0;
    },
  };

  const isUserDeleted = createUserDeletedCheck(redis, USER_ID, {
    isUserRowPresent: () => {
      counters.userRow += 1;
      return options.userRowPresent();
    },
    onProbeError: (error) => {
      probeErrors.push(error);
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
    readState: () => Promise.resolve({ existingMappings, localEvents: [], remoteEvents }),
    reconciliationScope: TEST_RECONCILIATION_SCOPE,
    userId: USER_ID,
  };

  return {
    emitted,
    get existsCalls() {
      return counters.exists;
    },
    probeErrors,
    run: () => syncCalendar(syncOptions),
    get userRowLookups() {
      return counters.userRow;
    },
    writes,
  };
};

const idsOfType = (writes: ProviderWrite[], type: ProviderWrite["type"]): string[] =>
  writes.filter((write) => write.type === type).flatMap((write) => write.ids);

describe("an unreadable tombstone must not let chunk zero through", () => {
  it("touches nothing when the tombstone write was lost and the user row is already gone", async () => {
    const scenario = makeScenario({
      existsResult: () => Promise.resolve(0),
      userRowPresent: () => Promise.resolve(false),
    });

    const result = await scenario.run();

    expect(idsOfType(scenario.writes, "delete")).toEqual([]);
    expect(idsOfType(scenario.writes, "push")).toEqual([]);
    expect(scenario.writes).toEqual([]);
    expect(result.removed).toBe(0);
    expect(result.aborted).toBe(true);
    expect(scenario.userRowLookups).toBe(1);
  });

  it("touches nothing when redis is unreachable and the user row is already gone", async () => {
    const scenario = makeScenario({
      existsResult: () => Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:6379")),
      userRowPresent: () => Promise.resolve(false),
    });

    const result = await scenario.run();

    expect(idsOfType(scenario.writes, "delete")).toEqual([]);
    expect(idsOfType(scenario.writes, "push")).toEqual([]);
    expect(scenario.writes).toEqual([]);
    expect(result.removed).toBe(0);
    expect(result.aborted).toBe(true);
    expect(scenario.existsCalls).toBeGreaterThan(0);
    expect(scenario.userRowLookups).toBe(1);
  });

  it("halts on the tombstone alone without ever consulting the user row", async () => {
    const scenario = makeScenario({
      existsResult: () => Promise.resolve(1),
      userRowPresent: () => Promise.resolve(true),
    });

    const result = await scenario.run();

    expect(scenario.writes).toEqual([]);
    expect(result.removed).toBe(0);
    expect(result.aborted).toBe(true);
    expect(scenario.userRowLookups).toBe(0);
  });

  it("runs a live customer's removes to completion when the user row probe rejects", async () => {
    const scenario = makeScenario({
      existsResult: () => Promise.resolve(0),
      userRowPresent: () => Promise.reject(new Error("database connection terminated")),
    });

    const result = await scenario.run();

    expect(idsOfType(scenario.writes, "delete")).toHaveLength(REMOVE_COUNT);
    expect(result.removed).toBe(REMOVE_COUNT);
    expect(result.aborted).toBeFalsy();
    expect(scenario.probeErrors.length).toBeGreaterThan(0);
  });
});

describe("the user row fallback answers on its first call", () => {
  it("reports deleted on the first await and caches the answer for later calls", async () => {
    let probeCalls = 0;
    const probeErrors: unknown[] = [];
    const check = createUserDeletedCheck(
      { exists: () => Promise.resolve(0) },
      USER_ID,
      {
        isUserRowPresent: () => {
          probeCalls += 1;
          return Promise.resolve(false);
        },
        onProbeError: (error) => {
          probeErrors.push(error);
        },
      },
    );

    const first = await check();

    expect(first).toBe(true);
    expect(probeCalls).toBe(1);

    const later = [await check(), await check(), await check()];

    expect(later).toEqual([true, true, true]);
    expect(probeCalls).toBe(1);
    expect(probeErrors).toEqual([]);
  });
});
