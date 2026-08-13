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

interface ProviderOverrides {
  deleteEvents?: (eventIds: string[]) => Promise<DeleteResult[]>;
  listRemoteEvents?: () => Promise<RemoteEvent[]>;
  pushEvents?: (events: MaterializedSyncableEvent[]) => Promise<PushResult[]>;
}

const makeProvider = (overrides: ProviderOverrides = {}) => ({
  deleteEvents: overrides.deleteEvents ?? (() => Promise.resolve([])),
  listRemoteEvents: overrides.listRemoteEvents ?? (() => Promise.resolve([])),
  pushEvents: overrides.pushEvents ?? (() => Promise.resolve([])),
});

const readPhaseTotal = (event: Record<string, unknown>): number =>
  PHASE_FIELDS.reduce((total, field) => total + (event[field] as number), 0);

const expectPhaseArithmetic = (event: Record<string, unknown>): void => {
  const reconcileDurationMs = event["sync.reconcile.duration_ms"] as number;
  const unattributedDurationMs = event["sync.phase.unattributed.duration_ms"] as number;

  for (const field of PHASE_FIELDS) {
    expect(Number.isFinite(event[field] as number), `${field} is finite`).toBe(true);
    expect(event[field] as number, `${field} is not negative`).toBeGreaterThanOrEqual(0);
  }
  expect(unattributedDurationMs).toBeGreaterThanOrEqual(0);
  expect(readPhaseTotal(event) + unattributedDurationMs).toBeCloseTo(reconcileDurationMs, 1);
};

interface RunOptions {
  existingMappings?: EventMapping[];
  flush?: (changes: PendingChanges) => Promise<void>;
  isCurrent?: () => Promise<boolean>;
  localEvents?: MaterializedSyncableEvent[];
  provider?: ReturnType<typeof makeProvider>;
  readState?: () => Promise<{
    existingMappings: EventMapping[];
    localEvents: MaterializedSyncableEvent[];
    remoteEvents: RemoteEvent[];
  }>;
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
    readState: options.readState ?? (() => Promise.resolve({
      existingMappings: options.existingMappings ?? [],
      localEvents: options.localEvents ?? [],
      remoteEvents: options.remoteEvents ?? [],
    })),
    reconciliationScope: TEST_RECONCILIATION_SCOPE,
    userId: "user-1",
  });
  expect(emitted).toHaveLength(1);
  return emitted[0] as Record<string, unknown>;
};

const makeMapping = (
  event: MaterializedSyncableEvent,
  overrides: Partial<EventMapping> = {},
): EventMapping => ({
  calendarId: "dest-cal-1",
  deleteIdentifier: `remote-${event.id}`,
  destinationEventUid: `remote-${event.id}`,
  endTime: event.endTime,
  eventStateId: event.id,
  id: `map-${event.id}`,
  sourceCalendarId: "cal-1",
  startTime: event.startTime,
  syncEventHash: "stale-hash",
  syncEventId: event.id,
  ...overrides,
});

describe("syncCalendar instrumentation transparency", () => {
  it("leaves the caller's provider object untouched across repeated runs", async () => {
    const provider = makeProvider({
      pushEvents: (events) => Promise.resolve(
        events.map((event) => ({ remoteId: `remote-${event.id}`, success: true })),
      ),
    });
    const before = { ...provider };

    for (let round = 0; round < 25; round += 1) {
      const event = await runSync({ localEvents: [makeEvent(`ev-${round}`)], provider });
      expect(event["outcome"]).toBe("success");
    }

    expect(provider.pushEvents).toBe(before.pushEvents);
    expect(provider.deleteEvents).toBe(before.deleteEvents);
    expect(provider.listRemoteEvents).toBe(before.listRemoteEvents);
    expect(Object.keys(provider).toSorted()).toEqual(Object.keys(before).toSorted());
  });

  it("hands the provider exactly the operations it would have received unwrapped", async () => {
    const calls: string[] = [];
    const pushed: MaterializedSyncableEvent[][] = [];
    const deleted: string[][] = [];
    const localEvents = Array.from({ length: 120 }, (_unused, index) => makeEvent(`ev-${index}`));
    const stale = localEvents.slice(0, 10);

    const provider = makeProvider({
      deleteEvents: (eventIds) => {
        calls.push("delete");
        deleted.push(eventIds);
        return Promise.resolve(eventIds.map(() => ({ success: true })));
      },
      pushEvents: (events) => {
        calls.push("push");
        pushed.push(events);
        return Promise.resolve(
          events.map((event) => ({ remoteId: `pushed-${event.id}`, success: true })),
        );
      },
    });

    const event = await runSync({
      existingMappings: stale.map((staleEvent) => makeMapping(staleEvent)),
      localEvents,
      provider,
      remoteEvents: stale.map((staleEvent) => ({
        deleteId: `remote-${staleEvent.id}`,
        endTime: staleEvent.endTime,
        isKeeperEvent: true,
        startTime: staleEvent.startTime,
        uid: `remote-${staleEvent.id}`,
      })),
    });

    expect(pushed.flat().length).toBe(120);
    expect(deleted.flat().length).toBe(10);
    expect(calls).toContain("delete");
    expect(Math.max(...pushed.map((batch) => batch.length))).toBeLessThanOrEqual(50);
    expect(new Set(pushed.flat().map((pushedEvent) => pushedEvent.id)).size).toBe(120);
    expect(pushed.flat().every((pushedEvent) => localEvents.includes(pushedEvent))).toBe(true);
    expect(event["sync.phase.provider_delete.duration_ms"] as number).toBeGreaterThanOrEqual(0);
    expectPhaseArithmetic(event);
  });

  it("rethrows a wrapped provider delete error with its identity and cause intact", async () => {
    const inner = new Error("socket hang up");
    const failure = new Error("destination delete failed", { cause: inner });
    const emitted: Record<string, unknown>[] = [];
    const localEvent = makeEvent("ev-1");

    await expect(syncCalendar({
      calendarId: "dest-cal-1",
      flush: () => Promise.resolve(),
      isCurrent: () => Promise.resolve(true),
      onSyncEvent: (event) => { emitted.push(event); },
      provider: makeProvider({
        deleteEvents: async () => {
          await delay(5);
          throw failure;
        },
      }),
      readState: () => Promise.resolve({
        existingMappings: [makeMapping(localEvent)],
        localEvents: [localEvent],
        remoteEvents: [{
          deleteId: "remote-ev-1",
          endTime: localEvent.endTime,
          isKeeperEvent: true,
          startTime: localEvent.startTime,
          uid: "remote-ev-1",
        }],
      }),
      reconciliationScope: TEST_RECONCILIATION_SCOPE,
      userId: "user-1",
    })).rejects.toSatisfy((error: unknown) => error === failure && (error as Error).cause === inner);

    const [event] = emitted;
    expect(event?.["outcome"]).toBe("error");
    expect(event?.["error.message"]).toBe("destination delete failed");
    expect(event?.["sync.phase.provider_delete.duration_ms"] as number).toBeGreaterThanOrEqual(2);
    expectPhaseArithmetic(event as Record<string, unknown>);
  });

  it("keeps the reconcile total and duration_ms in agreement on a slow run", async () => {
    const event = await runSync({
      localEvents: [makeEvent("ev-1")],
      provider: makeProvider({
        pushEvents: async () => {
          await delay(40);
          return [{ remoteId: "remote-1", success: true }];
        },
      }),
      readState: async () => {
        await delay(30);
        return { existingMappings: [], localEvents: [makeEvent("ev-1")], remoteEvents: [] };
      },
    });

    const reconcile = event["sync.reconcile.duration_ms"] as number;
    const durationMs = event["duration_ms"] as number;

    expect(reconcile).toBeGreaterThanOrEqual(70);
    expect(Math.abs(reconcile - durationMs)).toBeLessThanOrEqual(2);
  });

  it("does not let concurrent runs sharing one provider borrow each other's phase time", async () => {
    const provider = makeProvider({
      pushEvents: async (events) => {
        await delay((events[0]?.id.length ?? 1) * 10);
        return events.map((event) => ({ remoteId: `remote-${event.id}`, success: true }));
      },
    });

    const [fast, slow] = await Promise.all([
      runSync({ localEvents: [makeEvent("a")], provider }),
      runSync({ localEvents: [makeEvent("abcd")], provider }),
    ]);

    expect(fast["sync.phase.provider_push.duration_ms"] as number).toBeLessThan(30);
    expect(slow["sync.phase.provider_push.duration_ms"] as number).toBeGreaterThanOrEqual(35);
    expectPhaseArithmetic(fast);
    expectPhaseArithmetic(slow);
  });

  it("attributes a nested sync run inside the flush without corrupting either event", async () => {
    const innerEvents: Record<string, unknown>[] = [];
    const outer = await runSync({
      flush: async () => {
        const innerProvider = makeProvider({
          pushEvents: async (events) => {
            await delay(20);
            return events.map((event) => ({ remoteId: `inner-${event.id}`, success: true }));
          },
        });
        await syncCalendar({
          calendarId: "dest-cal-2",
          flush: () => Promise.resolve(),
          isCurrent: () => Promise.resolve(true),
          onSyncEvent: (event) => { innerEvents.push(event); },
          provider: innerProvider,
          readState: () => Promise.resolve({
            existingMappings: [],
            localEvents: [makeEvent("inner-1")],
            remoteEvents: [],
          }),
          reconciliationScope: TEST_RECONCILIATION_SCOPE,
          userId: "user-1",
        });
      },
      localEvents: [makeEvent("ev-1")],
      provider: makeProvider({
        pushEvents: () => Promise.resolve([{ remoteId: "remote-1", success: true }]),
      }),
    });

    const [inner] = innerEvents;
    expect(inner).toBeDefined();
    expectPhaseArithmetic(inner as Record<string, unknown>);
    expectPhaseArithmetic(outer);
    expect(inner?.["sync.phase.provider_push.duration_ms"] as number).toBeGreaterThanOrEqual(15);
    expect(outer["sync.phase.provider_push.duration_ms"] as number).toBeLessThan(15);
    expect(outer["sync.phase.checkpoint_flush.duration_ms"] as number)
      .toBeGreaterThanOrEqual(inner?.["sync.reconcile.duration_ms"] as number);
  });

  it("emits the same field set and never a negative remainder over many varied runs", async () => {
    const keySets = new Set<string>();

    for (let round = 0; round < 30; round += 1) {
      const localEvents = Array.from({ length: round % 4 }, (_unused, index) =>
        makeEvent(`ev-${round}-${index}`));
      const event = await runSync({
        localEvents,
        provider: makeProvider({
          pushEvents: (events) => Promise.resolve(
            events.map((pushed) => ({ remoteId: `remote-${pushed.id}`, success: true })),
          ),
        }),
      });
      keySets.add(Object.keys(event).filter((key) => key.startsWith("sync.")).toSorted().join("|"));
      expectPhaseArithmetic(event);
    }

    expect(keySets.size).toBe(1);
  });
});
