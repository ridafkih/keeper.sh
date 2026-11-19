import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncCalendar } from "../../../src/core/sync-engine/index";
import type {
  DeleteResult,
  MaterializedSyncableEvent,
  PushResult,
  RemoteEvent,
} from "../../../src/core/types";
import type { PendingChanges } from "../../../src/core/sync-engine/types";
import { elapse, expectPhaseDurations, installControlledClock } from "./phase-timing-harness";

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

const CURRENCY_CHECK_MS = 20;
const FLUSH_MS = 20;
const FOLLOWING_FLUSH_MS = 3;

beforeEach(() => {
  installControlledClock();
});

afterEach(() => {
  vi.restoreAllMocks();
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
    listRemoteEvents: () => Promise<RemoteEvent[]>;
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
        listRemoteEvents: () => Promise.resolve([]),
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

const phaseKeys = (event: Record<string, unknown>): string[] =>
  Object.keys(event).filter((key) => key.startsWith("sync.")).toSorted();

describe("syncCalendar phase attribution when a phase throws", () => {
  it("records the currency check that rejected", async () => {
    const { event, thrown } = await runSync({
      isCurrent: () => {
        elapse(CURRENCY_CHECK_MS);
        return Promise.reject(new Error("currency check failed"));
      },
    });

    expect((thrown as Error).message).toBe("currency check failed");
    expectPhaseDurations(event, { "sync.phase.currency_check.duration_ms": CURRENCY_CHECK_MS });
  });

  it("records the flush that rejected", async () => {
    const { event, thrown } = await runSync({
      flush: () => {
        elapse(FLUSH_MS);
        return Promise.reject(new Error("flush failed"));
      },
      localEvents: [makeEvent("event-1")],
    });

    expect((thrown as Error).message).toBe("flush failed");
    expectPhaseDurations(event, { "sync.phase.checkpoint_flush.duration_ms": FLUSH_MS });
  });

  it("keeps a failed run from leaking phase time into the runs that follow it", async () => {
    for (let round = 0; round < 5; round++) {
      const failure = await runSync({
        isCurrent: () => {
          elapse(CURRENCY_CHECK_MS);
          return Promise.reject(new Error("currency check failed"));
        },
      });
      expect(failure.thrown).toBeInstanceOf(Error);
      expectPhaseDurations(
        failure.event,
        { "sync.phase.currency_check.duration_ms": CURRENCY_CHECK_MS },
      );

      const success = await runSync({
        flush: () => {
          elapse(FOLLOWING_FLUSH_MS);
          return Promise.resolve();
        },
        localEvents: [makeEvent(`event-${round}`)],
      });
      expect(success.thrown).toBeNull();
      expectPhaseDurations(
        success.event,
        { "sync.phase.checkpoint_flush.duration_ms": FOLLOWING_FLUSH_MS },
      );
    }
  });

  it("emits the same phase field set whether the run succeeds or throws", async () => {
    const success = await runSync();
    const failure = await runSync({
      isCurrent: () => Promise.reject(new Error("nope")),
    });

    expect(phaseKeys(failure.event)).toEqual(phaseKeys(success.event));
  });
});
