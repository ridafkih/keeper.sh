import { describe, expect, it } from "vitest";
import { syncCalendar } from "../../../src/core/sync-engine/index";
import type {
  DeleteResult,
  MaterializedSyncableEvent,
  PushResult,
  RemoteEventListing,
} from "../../../src/core/types";
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
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });

const makeEvent = (id: string): MaterializedSyncableEvent => ({
  id,
  sourceEventUid: `uid-${id}`,
  startTime: new Date("2026-03-15T09:00:00Z"),
  endTime: new Date("2026-03-15T10:00:00Z"),
  summary: `Event ${id}`,
  calendarId: "cal-1",
  calendarName: "Test Calendar",
  calendarUrl: null,
});

interface RunOptions {
  flush?: (changes: PendingChanges) => Promise<void>;
  isCurrent?: () => Promise<boolean>;
  localEvents?: MaterializedSyncableEvent[];
  provider?: {
    deleteEvents: (eventIds: string[]) => Promise<DeleteResult[]>;
    listRemoteEvents: () => Promise<RemoteEventListing>;
    pushEvents: (events: MaterializedSyncableEvent[]) => Promise<PushResult[]>;
  };
}

const runSync = async (
  options: RunOptions = {},
): Promise<{ event: Record<string, unknown>; thrown: unknown }> => {
  const emitted: Record<string, unknown>[] = [];
  let thrown: unknown = null;
  try {
    await syncCalendar({
      calendarId: "dest-cal-1",
      flush: options.flush ?? (() => Promise.resolve()),
      isCurrent: options.isCurrent ?? (() => Promise.resolve(true)),
      onSyncEvent: (event) => {
        emitted.push(event);
      },
      provider: options.provider ?? {
        deleteEvents: () => Promise.resolve([]),
        listRemoteEvents: () => Promise.resolve({ items: [], rawItemCount: 0 }),
        pushEvents: (events) =>
          Promise.resolve(events.map((event) => ({
            eventId: event.id,
            success: true as const,
            remoteId: `remote-${event.id}`,
            deleteIdentifier: `remote-${event.id}`,
          }))),
      },
      readState: () => Promise.resolve({
        existingMappings: [],
        localEvents: options.localEvents ?? [],
        remoteEvents: [],
        remoteRawItemCount: 0,
      }),
      reconciliationScope: TEST_RECONCILIATION_SCOPE,
      userId: "user-1",
    });
  } catch (error) {
    thrown = error;
  }
  expect(emitted).toHaveLength(1);
  return { event: emitted[0] as Record<string, unknown>, thrown };
};

const expectBalanced = (event: Record<string, unknown>): number => {
  let attributed = 0;
  for (const field of PHASE_FIELDS) {
    const value = event[field];
    expect(typeof value, `${field} is a number`).toBe("number");
    expect(Number.isFinite(value as number), `${field} is finite`).toBe(true);
    expect(value as number).toBeGreaterThanOrEqual(0);
    attributed += value as number;
  }
  const reconcileDurationMs = event["sync.reconcile.duration_ms"] as number;
  const unattributedDurationMs = event["sync.phase.unattributed.duration_ms"] as number;
  expect(unattributedDurationMs).toBeGreaterThanOrEqual(0);
  expect(attributed + unattributedDurationMs).toBeCloseTo(reconcileDurationMs, 1);
  return attributed;
};

const phaseKeys = (event: Record<string, unknown>): string[] =>
  Object.keys(event).filter((key) => key.startsWith("sync.")).toSorted();

describe("syncCalendar phase attribution when a phase throws", () => {
  it("records the currency check that rejected", async () => {
    const { event, thrown } = await runSync({
      isCurrent: async () => {
        await delay(20);
        throw new Error("currency check failed");
      },
    });

    expect((thrown as Error).message).toBe("currency check failed");
    expect(event["sync.phase.currency_check.duration_ms"] as number).toBeGreaterThanOrEqual(15);
    expectBalanced(event);
  });

  it("records the flush that rejected", async () => {
    const { event, thrown } = await runSync({
      flush: async () => {
        await delay(20);
        throw new Error("flush failed");
      },
      localEvents: [makeEvent("event-1")],
    });

    expect((thrown as Error).message).toBe("flush failed");
    expect(event["sync.phase.checkpoint_flush.duration_ms"] as number).toBeGreaterThanOrEqual(15);
    expectBalanced(event);
  });

  it("keeps a failed run from leaking phase time into the runs that follow it", async () => {
    const attributedTotals: number[] = [];

    for (let round = 0; round < 5; round++) {
      const failure = await runSync({
        isCurrent: async () => {
          await delay(20);
          throw new Error("currency check failed");
        },
      });
      expect(failure.thrown).toBeInstanceOf(Error);
      expectBalanced(failure.event);

      const success = await runSync({ localEvents: [makeEvent(`event-${round}`)] });
      expect(success.thrown).toBeNull();
      attributedTotals.push(expectBalanced(success.event));
      expect(success.event["sync.phase.currency_check.duration_ms"] as number).toBeLessThan(15);
    }

    expect(Math.max(...attributedTotals) - Math.min(...attributedTotals)).toBeLessThan(20);
  });

  it("emits the same phase field set whether the run succeeds or throws", async () => {
    const success = await runSync();
    const failure = await runSync({
      isCurrent: () => Promise.reject(new Error("nope")),
    });

    expect(phaseKeys(failure.event)).toEqual(phaseKeys(success.event));
  });
});
