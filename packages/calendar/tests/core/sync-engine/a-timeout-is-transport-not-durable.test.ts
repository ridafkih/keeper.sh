import { describe, expect, it } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import { RequestTimeoutError, fetchWithTimeout } from "../../../src/core/utils/fetch-with-timeout";
import type { CalendarSyncProvider } from "../../../src/core/sync-engine/types";
import type { MaterializedSyncableEvent, PushResult, SyncOperation } from "../../../src/core/types";
import type { EventMapping } from "../../../src/core/events/mappings";

const DESTINATION_CALENDAR_ID = "dest-cal-1";
const FAILURES_BEFORE_REPLACEMENT = 3;
const UNREACHABLE_URL = "https://destination.invalid/calendars/synthetic/events";
const TIMEOUT_MS = 1;

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

/* A socket that accepts the request and then says nothing is what a 30-second Graph or CalDAV
   timeout looks like from here; only the abort ever settles it. */
const stubHangingFetch = (): (() => void) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_input: unknown, init?: RequestInit) => new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) {
      return;
    }
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  })) as typeof globalThis.fetch;

  return () => {
    globalThis.fetch = originalFetch;
  };
};

/* The name must come from the code that actually throws it, never from a string literal a test
   author guessed. */
const timeoutErrorFromRealRequest = async (): Promise<Error> => {
  const restoreFetch = stubHangingFetch();
  try {
    await fetchWithTimeout(UNREACHABLE_URL, { method: "PATCH" }, TIMEOUT_MS);
  } catch (error) {
    return error as Error;
  } finally {
    restoreFetch();
  }
  throw new Error("the request did not time out");
};

/* A cycle that learned nothing durable carries no counter at all, so only the recorded ones are
   evidence and the absent ones are the safe outcome. */
const isRecordedFailureCount = (counter: number | undefined): counter is number =>
  typeof counter === "number";

interface CycleRun {
  counters: (number | undefined)[];
  deleteCalls: string[][];
  pushCalls: MaterializedSyncableEvent[][];
  fallbacks: number[];
}

const createProvider = (
  errorType: string,
  deleteCalls: string[][],
  pushCalls: MaterializedSyncableEvent[][],
): CalendarSyncProvider => ({
  deleteEvents: (eventIds) => {
    deleteCalls.push(eventIds);
    return Promise.resolve(eventIds.map(() => ({ success: true })));
  },
  listRemoteEvents: () => Promise.resolve([]),
  pushEvents: (events) => {
    pushCalls.push(events);
    return Promise.resolve(events.map((event): PushResult => ({
      deleteId: `/calendar/${event.sourceEventUid}@keeper.sh.ics`,
      remoteId: `${event.sourceEventUid}@keeper.sh`,
      success: true,
    })));
  },
  updateEvents: (updates) => Promise.resolve(updates.map((): PushResult => ({
    error: "the request timed out",
    errorType,
    success: false,
  }))),
});

const runCycles = async (errorType: string, cycles: number): Promise<CycleRun> => {
  const deleteCalls: string[][] = [];
  const pushCalls: MaterializedSyncableEvent[][] = [];
  const provider = createProvider(errorType, deleteCalls, pushCalls);
  const counters: (number | undefined)[] = [];
  const fallbacks: number[] = [];
  let mapping: EventMapping = makeMapping();

  for (let cycle = 0; cycle < cycles; cycle += 1) {
    const outcome = await executeRemoteOperations(
      [makeReplacement()],
      [mapping],
      DESTINATION_CALENDAR_ID,
      provider,
    );

    const mappingId = mapping.id;
    const carried = (outcome.changes.updates ?? []).find((update) => update.id === mappingId);
    counters.push(carried?.consecutiveUpdateFailures);
    fallbacks.push(outcome.updateFallbacks);
    if (carried) {
      mapping = { ...mapping, ...carried, id: mappingId } as EventMapping;
    }
  }

  return { counters, deleteCalls, fallbacks, pushCalls };
};

describe("a timeout is transport, not durable evidence", () => {
  it("throws the name this codebase actually emits on a request timeout", async () => {
    const timeoutError = await timeoutErrorFromRealRequest();

    expect(timeoutError).toBeInstanceOf(RequestTimeoutError);
    expect(timeoutError.name).toBe("RequestTimeoutError");
  });

  it("never deletes the customer's event after repeated timeouts on the same mapping", async () => {
    const timeoutError = await timeoutErrorFromRealRequest();

    const run = await runCycles(timeoutError.name, FAILURES_BEFORE_REPLACEMENT + 1);

    expect(run.deleteCalls).toEqual([]);
    expect(run.pushCalls).toEqual([]);
    expect(run.fallbacks).toEqual(Array.from({ length: FAILURES_BEFORE_REPLACEMENT + 1 }, () => 0));
  });

  it("accumulates no durable evidence from a status-less timeout", async () => {
    const timeoutError = await timeoutErrorFromRealRequest();

    const run = await runCycles(timeoutError.name, FAILURES_BEFORE_REPLACEMENT);

    expect(run.counters).toHaveLength(FAILURES_BEFORE_REPLACEMENT);
    expect(run.counters.filter(isRecordedFailureCount)).toEqual([]);
  });
});
