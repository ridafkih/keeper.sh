import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncCalendar } from "../../../src/core/sync-engine/index";
import type { MaterializedSyncableEvent } from "../../../src/core/types";
import {
  elapse,
  expectPhaseDurations,
  installControlledClock,
  stepWallClock,
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

const HOUR_MS = 3_600_000;
const READ_STATE_MS = 25;
const REPEATED_READ_STATE_MS = 20;

const makeLocalEvent = (id: string): MaterializedSyncableEvent => ({
  calendarId: "cal-1",
  calendarName: "Test Calendar",
  calendarUrl: null,
  endTime: new Date("2026-03-15T10:00:00Z"),
  id,
  sourceEventUid: `uid-${id}`,
  startTime: new Date("2026-03-15T09:00:00Z"),
  summary: `Event ${id}`,
});

const runSync = async (
  readStateMs: number,
  wallClockStepMs = 0,
): Promise<Record<string, unknown>> => {
  const emitted: Record<string, unknown>[] = [];
  await syncCalendar({
    calendarId: "dest-cal-1",
    flush: () => Promise.resolve(),
    isCurrent: () => Promise.resolve(true),
    onSyncEvent: (event) => {
      emitted.push(event);
    },
    provider: {
      deleteEvents: () => Promise.resolve([]),
      listRemoteEvents: () => Promise.resolve([]),
      pushEvents: (events) =>
        Promise.resolve(
          events.map((event) => ({
            deleteIdentifier: `del-${event.id}`,
            eventId: event.id,
            remoteEventUid: `remote-${event.id}`,
            success: true as const,
          })),
        ),
    },
    readState: () => {
      elapse(readStateMs);
      stepWallClock(wallClockStepMs);
      return Promise.resolve({
        existingMappings: [],
        localEvents: [makeLocalEvent("a")],
        remoteEvents: [],
      });
    },
    reconciliationScope: TEST_RECONCILIATION_SCOPE,
    userId: "user-1",
  });
  const [event] = emitted;
  expect(emitted).toHaveLength(1);
  return event as Record<string, unknown>;
};

describe("syncCalendar phase attribution when the wall clock moves", () => {
  beforeEach(() => {
    installControlledClock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the reconcile total and the phases honest when the clock steps backwards", async () => {
    const event = await runSync(READ_STATE_MS, -HOUR_MS);

    expectPhaseDurations(
      event,
      { "sync.phase.read_state.duration_ms": READ_STATE_MS },
      { wallClockStepMs: -HOUR_MS },
    );
  });

  it("keeps the reconcile total honest when the clock jumps forwards", async () => {
    const event = await runSync(READ_STATE_MS, HOUR_MS);

    expectPhaseDurations(
      event,
      { "sync.phase.read_state.duration_ms": READ_STATE_MS },
      { wallClockStepMs: HOUR_MS },
    );
  });

  it("agrees with duration_ms when the clock is left alone, over repeated runs", async () => {
    for (let round = 0; round < 4; round++) {
      const event = await runSync(REPEATED_READ_STATE_MS);

      expectPhaseDurations(event, { "sync.phase.read_state.duration_ms": REPEATED_READ_STATE_MS });
    }
  });
});
