import { describe, expect, it } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import type { CalendarSyncProvider } from "../../../src/core/sync-engine/types";
import type {
  MaterializedSyncableEvent,
  PushResult,
  SyncOperation,
} from "../../../src/core/types";
import type { EventMapping } from "../../../src/core/events/mappings";

const DESTINATION_CALENDAR_ID = "dest-cal-1";
const FAILURES_BEFORE_REPLACEMENT = 3;

/*
 * A failure that carries no status and is not a transport error is ours -- an unaddressable
 * target, a serializer -- so it is durable on every destination. That keeps this about the
 * counter rather than about which statuses a given provider can escape.
 */
const DURABLE_FAILURE: PushResult = {
  error: "no addressable update target",
  errorType: "UnaddressableTargetError",
  success: false,
};

const makeEvent = (): MaterializedSyncableEvent => ({
  calendarId: "cal-1",
  calendarName: "Test Calendar",
  calendarUrl: null,
  endTime: new Date("2026-03-15T10:00:00Z"),
  id: "ev-1",
  sourceEventUid: "uid-ev-1",
  startTime: new Date("2026-03-15T09:00:00Z"),
  summary: "Quarterly review",
});

const makeMapping = (): EventMapping => ({
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier: "/calendar/remote-1@keeper.sh.ics",
  destinationEventUid: "remote-1@keeper.sh",
  endTime: new Date("2026-03-15T10:00:00Z"),
  eventStateId: "ev-1",
  id: "map-1",
  sourceCalendarId: "cal-1",
  startTime: new Date("2026-03-15T09:00:00Z"),
  syncEventHash: "stale-hash",
  syncEventId: "ev-1",
});

const makeReplacement = (): Extract<SyncOperation, { type: "replace" }> => ({
  deleteId: "/calendar/remote-1@keeper.sh.ics",
  event: makeEvent(),
  staleMappingId: "map-1",
  type: "replace",
  uid: "remote-1@keeper.sh",
});

interface CycleRun {
  counters: (number | undefined)[];
  deleteCalls: string[][];
}

const createProvider = (
  outcomes: boolean[],
  deleteCalls: string[][],
): { cycleProvider: (cycle: number) => CalendarSyncProvider } => {
  const cycleProvider = (cycle: number): CalendarSyncProvider => ({
    deleteEvents: (eventIds) => {
      deleteCalls.push(eventIds);
      return Promise.resolve(eventIds.map(() => ({ success: true })));
    },
    listRemoteEvents: () => Promise.resolve([]),
    pushEvents: (events) => Promise.resolve(events.map((event): PushResult => ({
      deleteId: `/calendar/${event.sourceEventUid}@keeper.sh.ics`,
      remoteId: `${event.sourceEventUid}@keeper.sh`,
      success: true,
    }))),
    updateEvents: (updates) => Promise.resolve(updates.map((update): PushResult => {
      if (outcomes[cycle]) {
        return { deleteId: update.deleteId, remoteId: "remote-1@keeper.sh", success: true };
      }
      return DURABLE_FAILURE;
    })),
  });

  return { cycleProvider };
};

/* The counter only means anything if it survives the flush, so each cycle starts from the last. */
const runCycles = async (outcomes: boolean[]): Promise<CycleRun> => {
  const deleteCalls: string[][] = [];
  const { cycleProvider } = createProvider(outcomes, deleteCalls);
  const counters: (number | undefined)[] = [];
  let mapping: EventMapping = makeMapping();

  for (let cycle = 0; cycle < outcomes.length; cycle += 1) {
    const outcome = await executeRemoteOperations(
      [makeReplacement()],
      [mapping],
      DESTINATION_CALENDAR_ID,
      cycleProvider(cycle),
    );

    const mappingId = mapping.id;
    const carried = (outcome.changes.updates ?? []).find((update) => update.id === mappingId);
    counters.push(carried?.consecutiveUpdateFailures);
    if (carried) {
      mapping = { ...mapping, ...carried, id: mappingId } as EventMapping;
    }
  }

  return { counters, deleteCalls };
};

describe("the failure counter is actually consecutive", () => {
  it("starts the evidence over whenever an update finally succeeds", async () => {
    const { counters, deleteCalls } = await runCycles([false, true, false, true, false]);

    expect(counters).toEqual([1, 0, 1, 0, 1]);
    expect(deleteCalls).toEqual([]);
  });

  it("never promotes on failures separated by healthy syncs, however many there are", async () => {
    const { deleteCalls } = await runCycles([false, true, false, true, false, true, false]);

    expect(deleteCalls).toEqual([]);
  });

  it("still promotes when the same failure repeats without relief", async () => {
    const { counters, deleteCalls } = await runCycles(
      Array.from({ length: FAILURES_BEFORE_REPLACEMENT }, () => false),
    );

    expect(counters.slice(0, FAILURES_BEFORE_REPLACEMENT - 1)).toEqual([1, 2]);
    expect(deleteCalls).toEqual([["/calendar/remote-1@keeper.sh.ics"]]);
  });

  it("spends the evidence on the promotion so the next cycle cannot promote again", async () => {
    const { counters, deleteCalls } = await runCycles([false, false, false, false]);

    expect(counters[FAILURES_BEFORE_REPLACEMENT - 1]).toBe(0);
    expect(deleteCalls).toHaveLength(1);
  });
});
