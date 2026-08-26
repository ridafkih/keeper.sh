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
const HALT_PUSH_CEILING = OPERATION_CHUNK_SIZE * 2;
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

const pushedIdsOf = (writes: ProviderWrite[]): string[] =>
  writes.filter((write) => write.type === "push").flatMap((write) => write.ids);

const presentThenAbsent = (): (() => Promise<boolean>) => {
  let call = 0;
  return () => {
    call += 1;
    return Promise.resolve(call <= 1);
  };
};

const rejectThenAbsent = (): (() => Promise<boolean>) => {
  let call = 0;
  return () => {
    call += 1;
    if (call <= 1) {
      return Promise.reject(new Error("remaining connection slots are reserved"));
    }
    return Promise.resolve(false);
  };
};

describe("a deletion that lands mid-run halts the run at the next chunk", () => {
  it("halts when redis is unreachable and the user row disappears mid-run", async () => {
    const scenario = makeScenario({
      existsResult: () => Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:6379")),
      userRowPresent: presentThenAbsent(),
    });

    const result = await scenario.run();

    expect(result.aborted).toBe(true);
    expect(result.removed).toBe(0);
    expect(scenario.userRowLookups).toBeGreaterThan(1);
    expect(deletedIdsOf(scenario.writes)).toEqual([]);
    expect(pushedIdsOf(scenario.writes).length).toBeLessThanOrEqual(HALT_PUSH_CEILING);
    expect(scenario.emitted.at(0)?.["outcome"]).toBe("aborted");
  });

  it("halts when the tombstone write was lost and the user row disappears mid-run", async () => {
    const scenario = makeScenario({
      existsResult: () => Promise.resolve(0),
      userRowPresent: presentThenAbsent(),
    });

    const result = await scenario.run();

    expect(result.aborted).toBe(true);
    expect(result.removed).toBe(0);
    expect(scenario.userRowLookups).toBeGreaterThan(1);
    expect(deletedIdsOf(scenario.writes)).toEqual([]);
    expect(pushedIdsOf(scenario.writes).length).toBeLessThanOrEqual(HALT_PUSH_CEILING);
  });

  it("halts when the first probe rejected and a later probe reports the row gone", async () => {
    const scenario = makeScenario({
      existsResult: () => Promise.resolve(0),
      userRowPresent: rejectThenAbsent(),
    });

    const result = await scenario.run();

    expect(result.aborted).toBe(true);
    expect(result.removed).toBe(0);
    expect(scenario.userRowLookups).toBeGreaterThan(1);
    expect(deletedIdsOf(scenario.writes)).toEqual([]);
    expect(pushedIdsOf(scenario.writes).length).toBeLessThanOrEqual(HALT_PUSH_CEILING);
  });
});

describe("the check never halts a live customer on a flaky probe", () => {
  it("reports not-deleted on every call when every probe rejects and reports each failure", async () => {
    const probeErrors: unknown[] = [];
    let probeCalls = 0;
    const check = createUserDeletedCheck(
      { exists: () => Promise.resolve(0) },
      USER_ID,
      {
        isUserRowPresent: () => {
          probeCalls += 1;
          return Promise.reject(new Error("remaining connection slots are reserved"));
        },
        onProbeError: (error) => {
          probeErrors.push(error);
        },
      },
    );

    const answers: boolean[] = [];
    for (let call = 0; call < 10; call += 1) {
      answers.push(await check());
    }

    expect(answers).toEqual(Array.from({ length: 10 }, () => false));
    expect(probeCalls).toBeGreaterThan(1);
    expect(probeErrors).toHaveLength(probeCalls);
  });

  it("never halts a run whose user row is present on every probe", async () => {
    const scenario = makeScenario({
      existsResult: () => Promise.resolve(0),
      userRowPresent: () => Promise.resolve(true),
    });

    const result = await scenario.run();

    expect(result.aborted).toBeFalsy();
    expect(result.removed).toBe(REMOVE_COUNT);
    expect(pushedIdsOf(scenario.writes)).toHaveLength(ADD_COUNT);
    expect(deletedIdsOf(scenario.writes)).toHaveLength(REMOVE_COUNT);
  });
});

describe("probe answers for an absent row are sticky and shared", () => {
  it("keeps reporting deleted once a probe has seen the row absent", async () => {
    const probeErrors: unknown[] = [];
    let probeCalls = 0;
    const check = createUserDeletedCheck(
      { exists: () => Promise.resolve(0) },
      USER_ID,
      {
        isUserRowPresent: () => {
          probeCalls += 1;
          if (probeCalls <= 1) {
            return Promise.resolve(false);
          }
          return Promise.reject(new Error("remaining connection slots are reserved"));
        },
        onProbeError: (error) => {
          probeErrors.push(error);
        },
      },
    );

    await check();
    const second = await check();
    const third = await check();

    expect([second, third]).toEqual([true, true]);
    expect(probeErrors).toEqual([]);
  });

  it("shares one in-flight probe across concurrent checks", async () => {
    const releases: ((present: boolean) => void)[] = [];
    const probeErrors: unknown[] = [];
    const check = createUserDeletedCheck(
      { exists: () => Promise.resolve(0) },
      USER_ID,
      {
        isUserRowPresent: () =>
          new Promise<boolean>((resolve) => {
            releases.push(resolve);
          }),
        onProbeError: (error) => {
          probeErrors.push(error);
        },
      },
    );

    const pending = Promise.all(Array.from({ length: 8 }, () => check()));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(releases).toHaveLength(1);
    for (const release of releases) {
      release(true);
    }

    expect(await pending).toEqual(Array.from({ length: 8 }, () => false));
  });
});
