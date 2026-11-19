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

type PhaseField = (typeof PHASE_FIELDS)[number];

const MONOTONIC_ORIGIN_MS = 1000;
const WALL_ORIGIN_MS = Date.parse("2026-03-15T08:00:00.000Z");

const READ_STATE_MS = 3;
const CURRENCY_CHECK_MS = 10;
const PUSH_MS = 10;
const SLOW_PUSH_MS = 15;
const DELETE_MS = 4;
const NORMALIZE_MS = 2;

const clock = { monotonicMs: MONOTONIC_ORIGIN_MS, wallMs: WALL_ORIGIN_MS };

const elapse = (durationMs: number): void => {
  clock.monotonicMs += durationMs;
  clock.wallMs += durationMs;
};

beforeEach(() => {
  clock.monotonicMs = MONOTONIC_ORIGIN_MS;
  clock.wallMs = WALL_ORIGIN_MS;
  vi.spyOn(performance, "now").mockImplementation(() => clock.monotonicMs);
  vi.spyOn(Date, "now").mockImplementation(() => clock.wallMs);
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
  normalizeEvent: (event: MaterializedSyncableEvent) => MaterializedSyncableEvent;
}> = {}) => ({
  pushEvents: overrides.pushEvents ?? (() => Promise.resolve([])),
  deleteEvents: overrides.deleteEvents ?? (() => Promise.resolve([])),
  listRemoteEvents: overrides.listRemoteEvents ?? (() => Promise.resolve([])),
  ...(overrides.normalizeEvent && { normalizeEvent: overrides.normalizeEvent }),
});

const expectPhaseDurations = (
  event: Record<string, unknown>,
  expectedPhases: Partial<Record<PhaseField, number>> = {},
  expectedUnattributedMs = 0,
): void => {
  let attributedMs = 0;
  for (const field of PHASE_FIELDS) {
    const expectedMs = expectedPhases[field] ?? 0;
    attributedMs += expectedMs;
    expect(event[field], field).toBe(expectedMs);
  }

  const reconcileMs = attributedMs + expectedUnattributedMs;
  expect(event["sync.phase.unattributed.duration_ms"]).toBe(expectedUnattributedMs);
  expect(event["sync.reconcile.duration_ms"]).toBe(reconcileMs);
  expect(event["duration_ms"]).toBe(reconcileMs);
};

interface RunOptions {
  existingMappings?: EventMapping[];
  flush?: (changes: PendingChanges) => Promise<void>;
  isCurrent?: () => Promise<boolean>;
  localEvents?: MaterializedSyncableEvent[];
  provider?: ReturnType<typeof makeProvider>;
  readStateMs?: number;
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
    readState: () => {
      elapse(options.readStateMs ?? 0);
      return Promise.resolve({
        existingMappings: options.existingMappings ?? [],
        localEvents: options.localEvents ?? [],
        remoteEvents: options.remoteEvents ?? [],
      });
    },
    reconciliationScope: TEST_RECONCILIATION_SCOPE,
    userId: "user-1",
  });
  const [event] = emitted;
  expect(emitted).toHaveLength(1);
  return event as Record<string, unknown>;
};

describe("syncCalendar phase attribution", () => {
  it("balances the phases against the reconcile total on an empty calendar", async () => {
    const event = await runSync({ readStateMs: READ_STATE_MS });

    expect(event["outcome"]).toBe("in-sync");
    expectPhaseDurations(event, { "sync.phase.read_state.duration_ms": READ_STATE_MS });
  });

  it("balances the phases against the reconcile total for a single add", async () => {
    const event = await runSync({
      localEvents: [makeEvent("ev-1")],
      provider: makeProvider({
        pushEvents: () => {
          elapse(PUSH_MS);
          return Promise.resolve([{ remoteId: "remote-1", success: true }]);
        },
      }),
    });

    expect(event["outcome"]).toBe("success");
    expectPhaseDurations(event, { "sync.phase.provider_push.duration_ms": PUSH_MS });
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
        deleteEvents: () => {
          elapse(DELETE_MS);
          return Promise.resolve([{ success: true }]);
        },
        pushEvents: () => {
          elapse(PUSH_MS);
          return Promise.resolve([{ remoteId: "remote-2", success: true }]);
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

    expectPhaseDurations(event, {
      "sync.phase.provider_delete.duration_ms": DELETE_MS,
      "sync.phase.provider_push.duration_ms": PUSH_MS,
    });
  });

  it("balances the phases when the run is superseded before compute", async () => {
    const event = await runSync({
      isCurrent: () => {
        elapse(CURRENCY_CHECK_MS);
        return Promise.resolve(false);
      },
      localEvents: [makeEvent("ev-1")],
    });

    expect(event["outcome"]).toBe("superseded");
    expectPhaseDurations(event, { "sync.phase.currency_check.duration_ms": CURRENCY_CHECK_MS });
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
        pushEvents: () => {
          elapse(PUSH_MS);
          return Promise.reject(failure);
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
    expectPhaseDurations(
      event as Record<string, unknown>,
      { "sync.phase.provider_push.duration_ms": PUSH_MS },
    );
  });

  it("does not carry phase totals from one run into the next", async () => {
    const provider = makeProvider({
      pushEvents: () => {
        elapse(SLOW_PUSH_MS);
        return Promise.resolve([{ remoteId: "remote-1", success: true }]);
      },
    });

    const first = await runSync({ localEvents: [makeEvent("ev-1")], provider });
    const second = await runSync({ provider });

    expectPhaseDurations(first, { "sync.phase.provider_push.duration_ms": SLOW_PUSH_MS });
    expectPhaseDurations(second);
  });

  it("keeps the phase totals stable across repeated identical runs", async () => {
    const outcomes: string[] = [];

    for (let round = 0; round < 4; round++) {
      const event = await runSync({
        localEvents: [makeEvent("ev-1")],
        provider: makeProvider({
          normalizeEvent: (localEvent) => {
            elapse(NORMALIZE_MS);
            return localEvent;
          },
          pushEvents: () => {
            elapse(PUSH_MS);
            return Promise.resolve([{ remoteId: `remote-${round}`, success: true }]);
          },
        }),
      });
      outcomes.push(event["outcome"] as string);
      expectPhaseDurations(
        event,
        { "sync.phase.provider_push.duration_ms": PUSH_MS },
        NORMALIZE_MS,
      );
    }

    expect(outcomes).toEqual(["success", "success", "success", "success"]);
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
    expectPhaseDurations(event);
  });
});
