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

const PUSH_MS = 3;
const DELETE_MS = 5;
const SLOW_READ_STATE_MS = 30;
const SLOW_PUSH_MS = 40;
const SHARED_FAST_PUSH_MS = 10;
const SHARED_SLOW_PUSH_MS = 40;
const INNER_PUSH_MS = 20;

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
        elapse(DELETE_MS);
        return Promise.resolve(eventIds.map(() => ({ success: true })));
      },
      pushEvents: (events) => {
        calls.push("push");
        pushed.push(events);
        elapse(PUSH_MS);
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
    expectPhaseDurations(event, {
      "sync.phase.provider_delete.duration_ms": deleted.length * DELETE_MS,
      "sync.phase.provider_push.duration_ms": pushed.length * PUSH_MS,
    });
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
        deleteEvents: () => {
          elapse(DELETE_MS);
          return Promise.reject(failure);
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
    expectPhaseDurations(
      event as Record<string, unknown>,
      { "sync.phase.provider_delete.duration_ms": DELETE_MS },
    );
  });

  it("keeps the reconcile total and duration_ms in agreement on a slow run", async () => {
    const event = await runSync({
      localEvents: [makeEvent("ev-1")],
      provider: makeProvider({
        pushEvents: () => {
          elapse(SLOW_PUSH_MS);
          return Promise.resolve([{ remoteId: "remote-1", success: true }]);
        },
      }),
      readState: () => {
        elapse(SLOW_READ_STATE_MS);
        return Promise.resolve({
          existingMappings: [],
          localEvents: [makeEvent("ev-1")],
          remoteEvents: [],
        });
      },
    });

    expectPhaseDurations(event, {
      "sync.phase.provider_push.duration_ms": SLOW_PUSH_MS,
      "sync.phase.read_state.duration_ms": SLOW_READ_STATE_MS,
    });
  });

  it("does not let concurrent runs sharing one provider borrow each other's phase time", async () => {
    const fastGate = createGate();
    const slowGate = createGate();
    const gatesByEventId = new Map([
      ["fast", fastGate],
      ["slow", slowGate],
    ]);

    const provider = makeProvider({
      pushEvents: async (events) => {
        await gatesByEventId.get(events[0]?.id ?? "")?.pass();
        return events.map((event) => ({ remoteId: `remote-${event.id}`, success: true }));
      },
    });

    const fastRun = runSync({ localEvents: [makeEvent("fast")], provider });
    const slowRun = runSync({ localEvents: [makeEvent("slow")], provider });

    await Promise.all([fastGate.entered, slowGate.entered]);
    elapse(SHARED_FAST_PUSH_MS);
    fastGate.release();
    const fast = await fastRun;
    elapse(SHARED_SLOW_PUSH_MS - SHARED_FAST_PUSH_MS);
    slowGate.release();
    const slow = await slowRun;

    expectPhaseDurations(fast, { "sync.phase.provider_push.duration_ms": SHARED_FAST_PUSH_MS });
    expectPhaseDurations(slow, { "sync.phase.provider_push.duration_ms": SHARED_SLOW_PUSH_MS });
  });

  it("attributes a nested sync run inside the flush without corrupting either event", async () => {
    const innerEvents: Record<string, unknown>[] = [];
    const outer = await runSync({
      flush: async () => {
        const innerProvider = makeProvider({
          pushEvents: (events) => {
            elapse(INNER_PUSH_MS);
            return Promise.resolve(
              events.map((event) => ({ remoteId: `inner-${event.id}`, success: true })),
            );
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

    expect(innerEvents).toHaveLength(1);
    expectPhaseDurations(
      innerEvents[0] as Record<string, unknown>,
      { "sync.phase.provider_push.duration_ms": INNER_PUSH_MS },
    );
    expectPhaseDurations(outer, { "sync.phase.checkpoint_flush.duration_ms": INNER_PUSH_MS });
  });

  it("emits the same field set and never a negative remainder over many varied runs", async () => {
    const keySets = new Set<string>();

    for (let round = 0; round < 30; round += 1) {
      const localEvents = Array.from({ length: round % 4 }, (_unused, index) =>
        makeEvent(`ev-${round}-${index}`));
      const event = await runSync({
        localEvents,
        provider: makeProvider({
          pushEvents: (events) => {
            elapse(PUSH_MS);
            return Promise.resolve(
              events.map((pushed) => ({ remoteId: `remote-${pushed.id}`, success: true })),
            );
          },
        }),
      });
      keySets.add(Object.keys(event).filter((key) => key.startsWith("sync.")).toSorted().join("|"));
      expectPhaseDurations(event, {
        "sync.phase.provider_push.duration_ms": Math.min(localEvents.length, 1) * PUSH_MS,
      });
    }

    expect(keySets.size).toBe(1);
  });
});
