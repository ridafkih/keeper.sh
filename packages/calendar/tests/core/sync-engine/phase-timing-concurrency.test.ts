import { describe, expect, it } from "vitest";
import { syncCalendar } from "../../../src/core/sync-engine/index";
import type {
  DeleteResult,
  MaterializedSyncableEvent,
  PushResult,
  RemoteEvent,
} from "../../../src/core/types";
import type { EventMapping } from "../../../src/core/events/mappings";
import type { PendingChanges } from "../../../src/core/sync-engine/types";

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

const PHASE_FIELDS = [
  "sync.phase.read_state.duration_ms",
  "sync.phase.currency_check.duration_ms",
  "sync.phase.compute_operations.duration_ms",
  "sync.phase.provider_push.duration_ms",
  "sync.phase.provider_delete.duration_ms",
  "sync.phase.checkpoint_flush.duration_ms",
  "sync.phase.mapping_flush.duration_ms",
] as const;

const delay = (durationMs: number): Promise<void> =>
  new Promise((resolve) => { setTimeout(resolve, durationMs); });

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

const readPhaseTotal = (event: Record<string, unknown>): number =>
  PHASE_FIELDS.reduce((total, field) => total + (event[field] as number), 0);

const expectPhaseArithmetic = (event: Record<string, unknown>): void => {
  const reconcileDurationMs = event["sync.reconcile.duration_ms"] as number;
  const unattributedDurationMs = event["sync.phase.unattributed.duration_ms"] as number;

  for (const field of PHASE_FIELDS) {
    expect(typeof event[field], `${field} is a number`).toBe("number");
    expect(Number.isFinite(event[field] as number), `${field} is finite`).toBe(true);
    expect(event[field] as number).toBeGreaterThanOrEqual(0);
  }

  expect(unattributedDurationMs).toBeGreaterThanOrEqual(0);
  expect(readPhaseTotal(event) + unattributedDurationMs).toBeCloseTo(reconcileDurationMs, 1);
  expect(reconcileDurationMs).toBeLessThanOrEqual((event["duration_ms"] as number) + 2);
  expect(reconcileDurationMs).toBeGreaterThanOrEqual((event["duration_ms"] as number) - 2);
};

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

const fastPush = (): Promise<PushResult[]> =>
  Promise.resolve([{ remoteId: "remote-fast", success: true }]);

describe("syncCalendar phase attribution under stress", () => {
  it("keeps two interleaved runs from borrowing each other's phase time", async () => {
    const slowPush = async (): Promise<PushResult[]> => {
      await delay(40);
      return [{ remoteId: "remote-slow", success: true }];
    };
    const [slowEvent, fastEvent] = await Promise.all([
      runSync({
        calendarId: "dest-slow",
        localEvents: [makeEvent("slow-1")],
        provider: makeProvider({ pushEvents: slowPush }),
      }),
      runSync({
        calendarId: "dest-fast",
        localEvents: [makeEvent("fast-1")],
        provider: makeProvider({ pushEvents: fastPush }),
      }),
    ]);

    expectPhaseArithmetic(slowEvent);
    expectPhaseArithmetic(fastEvent);
    expect(slowEvent["sync.phase.provider_push.duration_ms"] as number)
      .toBeGreaterThanOrEqual(30);
    expect(fastEvent["sync.phase.provider_push.duration_ms"] as number).toBeLessThan(20);
  });

  it("records read_state and balances when readState rejects", async () => {
    const emitted: Record<string, unknown>[] = [];
    await expect(syncCalendar({
      calendarId: "dest-cal-1",
      flush: () => Promise.resolve(),
      isCurrent: () => Promise.resolve(true),
      onSyncEvent: (event) => { emitted.push(event); },
      provider: makeProvider(),
      readState: async () => {
        await delay(15);
        throw new Error("read state exploded");
      },
      reconciliationScope: TEST_RECONCILIATION_SCOPE,
      userId: "user-1",
    })).rejects.toThrow("read state exploded");

    expect(emitted).toHaveLength(1);
    const event = emitted[0] as Record<string, unknown>;
    expect(event["outcome"]).toBe("error");
    expect(event["sync.phase.read_state.duration_ms"] as number).toBeGreaterThanOrEqual(10);
    expectPhaseArithmetic(event);
  });

  it("records checkpoint_flush and balances when the flush rejects", async () => {
    const emitted: Record<string, unknown>[] = [];
    await expect(syncCalendar({
      calendarId: "dest-cal-1",
      flush: async () => {
        await delay(15);
        throw new Error("flush exploded");
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
    expect(event["sync.phase.checkpoint_flush.duration_ms"] as number).toBeGreaterThanOrEqual(10);
    expectPhaseArithmetic(event);
  });

  it("does not double count across many operation chunks", async () => {
    const localEvents = Array.from({ length: 130 }, (_unused, index) =>
      makeEvent(`bulk-${index}`,
        new Date(Date.UTC(2026, 2, 15, 9, index % 60)),
        new Date(Date.UTC(2026, 2, 15, 10, index % 60))));

    let currencyChecks = 0;
    const event = await runSync({
      isCurrent: async () => {
        currencyChecks += 1;
        await delay(1);
        return true;
      },
      localEvents,
      provider: makeProvider({
        pushEvents: async (events) => {
          await delay(2);
          return events.map((pushed, index) => ({
            remoteId: `remote-${pushed.id}-${index}`,
            success: true,
          }));
        },
      }),
    });

    expect(currencyChecks).toBeGreaterThan(3);
    expect(event["outcome"]).toBe("success");
    expectPhaseArithmetic(event);
  });

  it("converges on identical phase field sets over repeated runs", async () => {
    const keySets: string[] = [];
    for (let round = 0; round < 4; round += 1) {
      const event = await runSync({
        localEvents: [makeEvent("ev-repeat")],
        provider: makeProvider({
          pushEvents: () => Promise.resolve([{ remoteId: "remote-repeat", success: true }]),
        }),
      });
      expectPhaseArithmetic(event);
      keySets.push(Object.keys(event).filter((key) => key.startsWith("sync.")).toSorted().join("|"));
    }
    expect(new Set(keySets).size).toBe(1);
  });

  it("keeps a slow checkpoint flush inside the reconcile total", async () => {
    const event = await runSync({
      flush: async () => {
        await delay(25);
      },
      localEvents: [makeEvent("ev-1")],
      provider: makeProvider({
        pushEvents: () => Promise.resolve([{ remoteId: "remote-1", success: true }]),
      }),
    });

    expect(event["sync.phase.checkpoint_flush.duration_ms"] as number)
      .toBeGreaterThanOrEqual(20);
    expectPhaseArithmetic(event);
  });
});
