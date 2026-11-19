import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncCalendar } from "../../../src/core/sync-engine/index";
import type {
  DeleteResult,
  MaterializedSyncableEvent,
  PushResult,
  RemoteEvent,
} from "../../../src/core/types";
import type { EventMapping } from "../../../src/core/events/mappings";
import type { PendingChanges } from "../../../src/core/sync-engine/types";
import {
  createGate,
  elapse,
  expectPhaseDurations,
  installControlledClock,
} from "./phase-timing-harness";

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

const FAST_PUSH_MS = 5;
const SLOW_PUSH_MS = 40;
const READ_STATE_MS = 15;
const FLUSH_MS = 15;
const SLOW_FLUSH_MS = 25;
const PUSH_MS = 7;

const BULK_EVENT_COUNT = 130;
const BULK_CHUNK_COUNT = 3;
const BULK_CURRENCY_CHECK_COUNT = 4;
const BULK_CURRENCY_CHECK_MS = 1;
const BULK_PUSH_MS = 2;

beforeEach(() => {
  installControlledClock();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const makeEvent = (
  id: string,
  startTime = new Date("2026-03-15T09:00:00Z"),
  endTime = new Date("2026-03-15T10:00:00Z"),
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

const makeProvider = (overrides: Partial<{
  pushEvents: (events: MaterializedSyncableEvent[]) => Promise<PushResult[]>;
  deleteEvents: (eventIds: string[]) => Promise<DeleteResult[]>;
  listRemoteEvents: () => Promise<RemoteEvent[]>;
}> = {}) => ({
  pushEvents: overrides.pushEvents ?? (() => Promise.resolve([])),
  deleteEvents: overrides.deleteEvents ?? (() => Promise.resolve([])),
  listRemoteEvents: overrides.listRemoteEvents ?? (() => Promise.resolve([])),
});

interface RunOptions {
  calendarId?: string;
  existingMappings?: EventMapping[];
  flush?: (changes: PendingChanges) => Promise<void>;
  isCurrent?: () => Promise<boolean>;
  localEvents?: MaterializedSyncableEvent[];
  provider?: ReturnType<typeof makeProvider>;
  remoteEvents?: RemoteEvent[];
}

const collectSync = async (
  options: RunOptions,
): Promise<{ emitted: Record<string, unknown>[]; error: unknown }> => {
  const emitted: Record<string, unknown>[] = [];
  let thrownError: unknown = null;
  try {
    await syncCalendar({
      calendarId: options.calendarId ?? "dest-cal-1",
      flush: options.flush ?? (() => Promise.resolve()),
      isCurrent: options.isCurrent ?? (() => Promise.resolve(true)),
      onSyncEvent: (event) => { emitted.push(event); },
      provider: options.provider ?? makeProvider(),
      readState: () => Promise.resolve({
        existingMappings: options.existingMappings ?? [],
        localEvents: options.localEvents ?? [],
        remoteEvents: options.remoteEvents ?? [],
      }),
      reconciliationScope: TEST_RECONCILIATION_SCOPE,
      userId: "user-1",
    });
  } catch (error) {
    thrownError = error;
  }
  return { emitted, error: thrownError };
};

const runSync = async (options: RunOptions = {}): Promise<Record<string, unknown>> => {
  const { emitted, error } = await collectSync(options);
  expect(error).toBeNull();
  expect(emitted).toHaveLength(1);
  return emitted[0] as Record<string, unknown>;
};

describe("syncCalendar phase attribution under stress", () => {
  it("keeps two interleaved runs from borrowing each other's phase time", async () => {
    const slowGate = createGate();
    const fastGate = createGate();

    const slowRun = runSync({
      calendarId: "dest-slow",
      localEvents: [makeEvent("slow-1")],
      provider: makeProvider({
        pushEvents: async () => {
          await slowGate.pass();
          return [{ remoteId: "remote-slow", success: true }];
        },
      }),
    });
    const fastRun = runSync({
      calendarId: "dest-fast",
      localEvents: [makeEvent("fast-1")],
      provider: makeProvider({
        pushEvents: async () => {
          await fastGate.pass();
          return [{ remoteId: "remote-fast", success: true }];
        },
      }),
    });

    await Promise.all([slowGate.entered, fastGate.entered]);
    elapse(FAST_PUSH_MS);
    fastGate.release();
    const fastEvent = await fastRun;
    elapse(SLOW_PUSH_MS - FAST_PUSH_MS);
    slowGate.release();
    const slowEvent = await slowRun;

    expectPhaseDurations(fastEvent, { "sync.phase.provider_push.duration_ms": FAST_PUSH_MS });
    expectPhaseDurations(slowEvent, { "sync.phase.provider_push.duration_ms": SLOW_PUSH_MS });
  });

  it("records read_state and balances when readState rejects", async () => {
    const emitted: Record<string, unknown>[] = [];
    await expect(syncCalendar({
      calendarId: "dest-cal-1",
      flush: () => Promise.resolve(),
      isCurrent: () => Promise.resolve(true),
      onSyncEvent: (event) => { emitted.push(event); },
      provider: makeProvider(),
      readState: () => {
        elapse(READ_STATE_MS);
        return Promise.reject(new Error("read state exploded"));
      },
      reconciliationScope: TEST_RECONCILIATION_SCOPE,
      userId: "user-1",
    })).rejects.toThrow("read state exploded");

    expect(emitted).toHaveLength(1);
    const event = emitted[0] as Record<string, unknown>;
    expect(event["outcome"]).toBe("error");
    expectPhaseDurations(event, { "sync.phase.read_state.duration_ms": READ_STATE_MS });
  });

  it("records checkpoint_flush and balances when the flush rejects", async () => {
    const emitted: Record<string, unknown>[] = [];
    await expect(syncCalendar({
      calendarId: "dest-cal-1",
      flush: () => {
        elapse(FLUSH_MS);
        return Promise.reject(new Error("flush exploded"));
      },
      isCurrent: () => Promise.resolve(true),
      onSyncEvent: (event) => { emitted.push(event); },
      provider: makeProvider({
        pushEvents: () => Promise.resolve([{ remoteId: "remote-1", success: true }]),
      }),
      readState: () => Promise.resolve({
        existingMappings: [],
        localEvents: [makeEvent("ev-1")],
        remoteEvents: [],
      }),
      reconciliationScope: TEST_RECONCILIATION_SCOPE,
      userId: "user-1",
    })).rejects.toThrow("flush exploded");

    expect(emitted).toHaveLength(1);
    const event = emitted[0] as Record<string, unknown>;
    expect(event["outcome"]).toBe("error");
    expectPhaseDurations(event, { "sync.phase.checkpoint_flush.duration_ms": FLUSH_MS });
  });

  it("does not double count across many operation chunks", async () => {
    const localEvents = Array.from({ length: BULK_EVENT_COUNT }, (_unused, index) =>
      makeEvent(`bulk-${index}`,
        new Date(Date.UTC(2026, 2, 15, 9, index % 60)),
        new Date(Date.UTC(2026, 2, 15, 10, index % 60))));

    let currencyChecks = 0;
    let pushCalls = 0;
    const event = await runSync({
      isCurrent: () => {
        currencyChecks += 1;
        elapse(BULK_CURRENCY_CHECK_MS);
        return Promise.resolve(true);
      },
      localEvents,
      provider: makeProvider({
        pushEvents: (events) => {
          pushCalls += 1;
          elapse(BULK_PUSH_MS);
          return Promise.resolve(events.map((pushed, index) => ({
            remoteId: `remote-${pushed.id}-${index}`,
            success: true,
          })));
        },
      }),
    });

    expect(currencyChecks).toBe(BULK_CURRENCY_CHECK_COUNT);
    expect(pushCalls).toBe(BULK_CHUNK_COUNT);
    expect(event["outcome"]).toBe("success");
    expectPhaseDurations(event, {
      "sync.phase.currency_check.duration_ms": BULK_CURRENCY_CHECK_COUNT * BULK_CURRENCY_CHECK_MS,
      "sync.phase.provider_push.duration_ms": BULK_CHUNK_COUNT * BULK_PUSH_MS,
    });
  });

  it("converges on identical phase field sets over repeated runs", async () => {
    const keySets: string[] = [];
    for (let round = 0; round < 4; round += 1) {
      const event = await runSync({
        localEvents: [makeEvent("ev-repeat")],
        provider: makeProvider({
          pushEvents: () => {
            elapse(PUSH_MS);
            return Promise.resolve([{ remoteId: "remote-repeat", success: true }]);
          },
        }),
      });
      expectPhaseDurations(event, { "sync.phase.provider_push.duration_ms": PUSH_MS });
      keySets.push(Object.keys(event).filter((key) => key.startsWith("sync.")).toSorted().join("|"));
    }
    expect(new Set(keySets).size).toBe(1);
  });

  it("keeps a slow checkpoint flush inside the reconcile total", async () => {
    const event = await runSync({
      flush: () => {
        elapse(SLOW_FLUSH_MS);
        return Promise.resolve();
      },
      localEvents: [makeEvent("ev-1")],
      provider: makeProvider({
        pushEvents: () => Promise.resolve([{ remoteId: "remote-1", success: true }]),
      }),
    });

    expectPhaseDurations(event, { "sync.phase.checkpoint_flush.duration_ms": SLOW_FLUSH_MS });
  });
});
