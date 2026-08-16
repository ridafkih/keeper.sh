import { afterEach, describe, expect, it, vi } from "vitest";
import { syncCalendar } from "../../../src/core/sync-engine/index";
import type { MaterializedSyncableEvent } from "../../../src/core/types";

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
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });

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
  readStateDelayMs: number,
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
      listRemoteEvents: () => Promise.resolve({ items: [], rawItemCount: 0 }),
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
    readState: async () => {
      await delay(readStateDelayMs);
      return {
        existingMappings: [],
        localEvents: [makeLocalEvent("a")],
        remoteEvents: [],
        remoteRawItemCount: 0,
      };
    },
    reconciliationScope: TEST_RECONCILIATION_SCOPE,
    userId: "user-1",
  });
  const [event] = emitted;
  expect(emitted).toHaveLength(1);
  return event as Record<string, unknown>;
};

const sumPhases = (event: Record<string, unknown>): number =>
  PHASE_FIELDS.reduce((total, field) => total + (event[field] as number), 0);

describe("syncCalendar phase attribution when the wall clock moves", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the reconcile total and the phases honest when the clock steps backwards", async () => {
    const realNow = Date.now.bind(Date);
    const baseline = realNow();
    let calls = 0;
    vi.spyOn(Date, "now").mockImplementation(() => {
      calls += 1;
      if (calls === 1) {
        return baseline;
      }
      return baseline - 3_600_000;
    });

    const event = await runSync(25);

    const reconcileDurationMs = event["sync.reconcile.duration_ms"] as number;
    const unattributedDurationMs = event["sync.phase.unattributed.duration_ms"] as number;

    expect(Number.isFinite(reconcileDurationMs)).toBe(true);
    expect(reconcileDurationMs).toBeGreaterThanOrEqual(25);
    expect(unattributedDurationMs).toBeGreaterThanOrEqual(0);
    expect(sumPhases(event) + unattributedDurationMs).toBeCloseTo(reconcileDurationMs, 1);
    expect(event["sync.phase.read_state.duration_ms"] as number).toBeGreaterThanOrEqual(25);
  });

  it("keeps the reconcile total honest when the clock jumps forwards", async () => {
    const realNow = Date.now.bind(Date);
    const baseline = realNow();
    let calls = 0;
    vi.spyOn(Date, "now").mockImplementation(() => {
      calls += 1;
      if (calls === 1) {
        return baseline;
      }
      return baseline + 3_600_000;
    });

    const event = await runSync(25);

    const reconcileDurationMs = event["sync.reconcile.duration_ms"] as number;
    expect(reconcileDurationMs).toBeLessThan(3_600_000);
    expect(sumPhases(event) + (event["sync.phase.unattributed.duration_ms"] as number))
      .toBeCloseTo(reconcileDurationMs, 1);
  });

  it("agrees with duration_ms when the clock is left alone, over repeated runs", async () => {
    for (let round = 0; round < 4; round++) {
      const event = await runSync(20);
      const reconcileDurationMs = event["sync.reconcile.duration_ms"] as number;
      const durationMs = event["duration_ms"] as number;
      expect(Math.abs(reconcileDurationMs - durationMs)).toBeLessThanOrEqual(2);
    }
  });
});
