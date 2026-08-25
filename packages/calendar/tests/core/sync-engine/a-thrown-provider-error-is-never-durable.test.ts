import { describe, expect, it } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import { computeSyncOperations } from "../../../src/core/sync/operations";
import type { DeleteResult, MaterializedSyncableEvent, PushResult, RemoteEvent } from "../../../src/core/types";
import type { CalendarSyncProvider, EventUpdate } from "../../../src/core/sync-engine/types";
import type { EventMapping } from "../../../src/core/events/mappings";

const DESTINATION_CALENDAR_ID = "dest-cal-1";
const START_TIME = new Date("2026-03-15T09:00:00Z");
const END_TIME = new Date("2026-03-15T10:00:00Z");

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

/* Mirrors providers/google/shared/batch.ts: a whole-batch non-2xx is THROWN, and the numeric
   status rides on the error rather than on any returned PushResult. */
class GoogleBatchApiError extends Error {
  public readonly status: number;
  constructor(status: number, body: string) {
    super(`Google Batch API ${status}: ${body}`);
    this.name = "GoogleBatchApiError";
    this.status = status;
  }
}

const makeEvent = (id: string, summary: string): MaterializedSyncableEvent => ({
  id,
  sourceEventUid: `uid-${id}`,
  startTime: START_TIME,
  endTime: END_TIME,
  summary,
  calendarId: "cal-1",
  calendarName: "Test Calendar",
  calendarUrl: null,
});

const makeMapping = (id: string, eventId: string, syncEventHash: string): EventMapping => ({
  remoteAvailability: null,
  remoteContentHash: null,
  remoteEndTime: null,
  remoteStartTime: null,
  id,
  eventStateId: eventId,
  syncEventId: eventId,
  calendarId: DESTINATION_CALENDAR_ID,
  sourceCalendarId: "cal-1",
  destinationEventUid: `remote-${eventId}@keeper.sh`,
  deleteIdentifier: `remote-${eventId}@keeper.sh`,
  syncEventHash,
  startTime: START_TIME,
  endTime: END_TIME,
});

const makeRemoteEvent = (eventId: string): RemoteEvent => ({
  deleteId: `remote-${eventId}@keeper.sh`,
  endTime: END_TIME,
  isKeeperEvent: true,
  startTime: START_TIME,
  uid: `remote-${eventId}@keeper.sh`,
});

const createThrowingProvider = (throwWith: () => unknown) => {
  const deleteTargets: string[] = [];
  const pushedEvents: MaterializedSyncableEvent[] = [];

  const provider: CalendarSyncProvider = {
    deleteEvents: (eventIds) => {
      deleteTargets.push(...eventIds);
      return Promise.resolve(eventIds.map((): DeleteResult => ({ removedObject: true, success: true })));
    },
    listRemoteEvents: () => Promise.resolve([]),
    pushEvents: (events) => {
      pushedEvents.push(...events);
      return Promise.resolve(events.map((event): PushResult => ({
        deleteId: `recreated-${event.id}@keeper.sh`,
        remoteId: `recreated-${event.id}@keeper.sh`,
        success: true,
      })));
    },
    // Google's updateEvents has no try/catch, so the batch throw reaches the sync engine.
    updateEvents: (_updates: EventUpdate[]) => Promise.reject(throwWith()),
  };

  return { deleteTargets, provider, pushedEvents };
};

const failureCountFor = (
  updates: { consecutiveUpdateFailures?: number; id: string }[] | undefined,
  mappingId: string,
): number =>
  updates?.find((update) => update.id === mappingId)?.consecutiveUpdateFailures ?? 0;

const runThreeCycles = async (throwWith: () => unknown) => {
  const event = makeEvent("ev-1", "Dentist renamed");
  let mapping = makeMapping("map-1", "ev-1", "stale-hash");
  const destination = createThrowingProvider(throwWith);
  const counters: number[] = [];

  for (let cycle = 0; cycle < 3; cycle++) {
    const { operations } = computeSyncOperations(
      [event],
      [mapping],
      [makeRemoteEvent("ev-1")],
      TEST_RECONCILIATION_SCOPE,
    );
    expect(operations).toHaveLength(1);
    expect(operations[0]?.type).toBe("replace");

    const outcome = await executeRemoteOperations(
      operations,
      [mapping],
      DESTINATION_CALENDAR_ID,
      destination.provider,
    );

    const failures = failureCountFor(outcome.changes.updates, "map-1");
    counters.push(failures);
    // Flush the counter back onto the mapping, exactly as the persisted row would carry it.
    mapping = { ...mapping, consecutiveUpdateFailures: failures };
  }

  return { counters, destination };
};

describe("a thrown provider error is never durable", () => {
  it("never deletes and never promotes across three cycles of a thrown 503", async () => {
    const { counters, destination } = await runThreeCycles(
      () => new GoogleBatchApiError(503, "backendError"),
    );

    // A thrown 503 must classify exactly as a returned 503: retryable, never durable.
    expect(destination.deleteTargets).toEqual([]);
    expect(destination.pushedEvents).toEqual([]);
    expect(counters).toEqual([0, 0, 0]);
  });

  it("never deletes and never promotes across three cycles of a status-less throw", async () => {
    const { counters, destination } = await runThreeCycles(
      () => new Error("something went wrong inside the provider"),
    );

    // No status and no transport signal is UNKNOWN, not positive evidence of a broken mapping.
    expect(destination.deleteTargets).toEqual([]);
    expect(destination.pushedEvents).toEqual([]);
    expect(counters).toEqual([0, 0, 0]);
  });

  it("counts one run-level throw as one failure rather than one per mapping in the run", async () => {
    const events = [makeEvent("ev-1", "Dentist renamed"), makeEvent("ev-2", "Standup renamed")];
    const mappings = [
      makeMapping("map-1", "ev-1", "stale-hash"),
      makeMapping("map-2", "ev-2", "stale-hash"),
    ];
    const destination = createThrowingProvider(() => new GoogleBatchApiError(503, "backendError"));

    const { operations } = computeSyncOperations(
      events,
      mappings,
      [makeRemoteEvent("ev-1"), makeRemoteEvent("ev-2")],
      TEST_RECONCILIATION_SCOPE,
    );
    expect(operations).toHaveLength(2);

    const outcome = await executeRemoteOperations(
      operations,
      mappings,
      DESTINATION_CALENDAR_ID,
      destination.provider,
    );

    expect(outcome.errors).toHaveLength(1);
    expect(destination.deleteTargets).toEqual([]);
    expect(failureCountFor(outcome.changes.updates, "map-1")).toBe(0);
    expect(failureCountFor(outcome.changes.updates, "map-2")).toBe(0);
  });
});
