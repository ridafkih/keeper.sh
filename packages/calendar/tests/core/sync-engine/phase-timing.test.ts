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
import { createSyncEventContentHash } from "../../../src/core/events/content-hash";

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
};

interface RunOptions {
  existingMappings?: EventMapping[];
  flush?: (changes: PendingChanges) => Promise<void>;
  isCurrent?: () => Promise<boolean>;
  localEvents?: MaterializedSyncableEvent[];
  provider?: ReturnType<typeof makeProvider>;
  remoteEvents?: RemoteEvent[];
}

const runSync = async (options: RunOptions = {}): Promise<Record<string, unknown>> => {
  const emitted: Record<string, unknown>[] = [];
  await syncCalendar({
    calendarId: "dest-cal-1",
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
  const [event] = emitted;
  expect(emitted).toHaveLength(1);
  return event as Record<string, unknown>;
};

describe("syncCalendar phase attribution", () => {
  it("balances the phases against the reconcile total on an empty calendar", async () => {
    const event = await runSync();

    expect(event["outcome"]).toBe("in-sync");
    expectPhaseArithmetic(event);
  });

  it("balances the phases against the reconcile total for a single add", async () => {
    const event = await runSync({
      localEvents: [makeEvent("ev-1")],
      provider: makeProvider({
        pushEvents: async () => {
          await delay(10);
          return [{ remoteId: "remote-1", success: true }];
        },
      }),
    });

    expect(event["outcome"]).toBe("success");
    expect(event["sync.phase.provider_push.duration_ms"] as number).toBeGreaterThanOrEqual(5);
    expectPhaseArithmetic(event);
  });

  it("attributes provider deletes when a stale mapping is replaced", async () => {
    const localEvent = makeEvent("ev-1");
    const mapping: EventMapping = {
      calendarId: "dest-cal-1",
      deleteIdentifier: "remote-1",
      destinationEventUid: "remote-1",
      endTime: localEvent.endTime,
      eventStateId: "ev-1",
      id: "map-1",
      sourceCalendarId: "cal-1",
      startTime: localEvent.startTime,
      syncEventHash: "stale-hash",
      syncEventId: "ev-1",
    };

    const event = await runSync({
      existingMappings: [mapping],
      localEvents: [localEvent],
      provider: makeProvider({
        deleteEvents: async () => {
          await delay(10);
          return [{ success: true }];
        },
        pushEvents: async () => {
          await delay(10);
          return [{ remoteId: "remote-2", success: true }];
        },
      }),
      remoteEvents: [{
        deleteId: "remote-1",
        endTime: localEvent.endTime,
        isKeeperEvent: true,
        startTime: localEvent.startTime,
        uid: "remote-1",
      }],
    });

    expect(event["sync.phase.provider_delete.duration_ms"] as number).toBeGreaterThanOrEqual(5);
    expect(event["sync.phase.provider_push.duration_ms"] as number).toBeGreaterThanOrEqual(5);
    expectPhaseArithmetic(event);
  });

  it("balances the phases when the run is superseded before compute", async () => {
    const event = await runSync({
      isCurrent: async () => {
        await delay(10);
        return false;
      },
      localEvents: [makeEvent("ev-1")],
    });

    expect(event["outcome"]).toBe("superseded");
    expect(event["sync.phase.compute_operations.duration_ms"]).toBe(0);
    expectPhaseArithmetic(event);
  });

  it("balances the phases when the provider push rejects", async () => {
    const failure = new Error("provider exploded");
    const emitted: Record<string, unknown>[] = [];

    await expect(syncCalendar({
      calendarId: "dest-cal-1",
      flush: () => Promise.resolve(),
      isCurrent: () => Promise.resolve(true),
      onSyncEvent: (event) => { emitted.push(event); },
      provider: makeProvider({
        pushEvents: async () => {
          await delay(10);
          throw failure;
        },
      }),
      readState: () => Promise.resolve({
        existingMappings: [],
        localEvents: [makeEvent("ev-1")],
        remoteEvents: [],
      }),
      reconciliationScope: TEST_RECONCILIATION_SCOPE,
      userId: "user-1",
    })).rejects.toBe(failure);

    const [event] = emitted;
    expect(event?.["outcome"]).toBe("error");
    expect(event?.["sync.phase.provider_push.duration_ms"] as number).toBeGreaterThanOrEqual(5);
    expectPhaseArithmetic(event as Record<string, unknown>);
  });

  it("does not carry phase totals from one run into the next", async () => {
    const provider = makeProvider({
      pushEvents: async () => {
        await delay(15);
        return [{ remoteId: "remote-1", success: true }];
      },
    });

    const first = await runSync({ localEvents: [makeEvent("ev-1")], provider });
    const second = await runSync({ provider });

    expect(first["sync.phase.provider_push.duration_ms"] as number).toBeGreaterThanOrEqual(10);
    expect(second["sync.phase.provider_push.duration_ms"]).toBe(0);
    expectPhaseArithmetic(second);
  });

  it("keeps the phase totals stable across repeated identical runs", async () => {
    const outcomes: string[] = [];
    const unattributed: number[] = [];

    for (let round = 0; round < 4; round++) {
      const event = await runSync({
        localEvents: [makeEvent("ev-1")],
        provider: makeProvider({
          pushEvents: () => Promise.resolve([{ remoteId: `remote-${round}`, success: true }]),
        }),
      });
      outcomes.push(event["outcome"] as string);
      unattributed.push(event["sync.phase.unattributed.duration_ms"] as number);
      expectPhaseArithmetic(event);
    }

    expect(outcomes).toEqual(["success", "success", "success", "success"]);
    for (const value of unattributed) {
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });

  it("passes provider arguments and results through untouched", async () => {
    const pushed: MaterializedSyncableEvent[][] = [];
    const localEvent = makeEvent("ev-1");
    const pushResult: PushResult = { remoteId: "remote-1", success: true };

    const event = await runSync({
      localEvents: [localEvent],
      provider: makeProvider({
        pushEvents: (events) => {
          pushed.push(events);
          return Promise.resolve([pushResult]);
        },
      }),
    });

    expect(pushed).toHaveLength(1);
    expect(pushed[0]?.[0]).toBe(localEvent);
    expect(event["events.added"]).toBe(1);
  });

  it("emits a phase field for every phase on a run that pushes", async () => {
    const event = await runSync({
      localEvents: [makeEvent("ev-1")],
      provider: makeProvider({
        pushEvents: () => Promise.resolve([{ remoteId: "remote-1", success: true }]),
      }),
    });

    for (const field of PHASE_FIELDS) {
      expect(event[field]).toBeTypeOf("number");
    }
    expect(createSyncEventContentHash).toBeTypeOf("function");
    expectPhaseArithmetic(event);
  });
});
