import { describe, expect, it } from "vitest";
import { executeRemoteOperations, syncCalendar } from "../../../src/core/sync-engine/index";
import { resolveDestinationAttemptVerdict } from "../../../../sync/src/destination-errors";
import type { CalendarSyncProvider, EventUpdate } from "../../../src/core/sync-engine/types";
import type { MaterializedSyncableEvent, PushResult, RemoteEvent, SyncOperation } from "../../../src/core/types";
import type { EventMapping } from "../../../src/core/events/mappings";

const DESTINATION_CALENDAR_ID = "dest-cal-1";
const EVENT_INDEXES = [1, 2, 3];
const START_TIME = new Date("2026-03-15T09:00:00.000Z");
const END_TIME = new Date("2026-03-15T10:00:00.000Z");

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

const makeEvent = (index: number): MaterializedSyncableEvent => ({
  calendarId: "cal-1",
  calendarName: "Test Calendar",
  calendarUrl: null,
  endTime: END_TIME,
  id: `ev-${index}`,
  sourceEventUid: `uid-ev-${index}`,
  startTime: START_TIME,
  summary: `Event ${index} renamed`,
});

const makeMapping = (index: number): EventMapping => ({
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier: `/calendar/remote-${index}@keeper.sh.ics`,
  destinationEventUid: `remote-${index}@keeper.sh`,
  endTime: END_TIME,
  eventStateId: `ev-${index}`,
  id: `map-${index}`,
  sourceCalendarId: "cal-1",
  startTime: START_TIME,
  // Diverged from the event's current content, so reconciliation plans an in-place update.
  syncEventHash: "diverged-remote-hash",
  syncEventId: `ev-${index}`,
});

const makeReplacement = (mapping: EventMapping, event: MaterializedSyncableEvent): Extract<SyncOperation, { type: "replace" }> => ({
  deleteId: mapping.deleteIdentifier,
  event,
  staleMappingId: mapping.id,
  type: "replace",
  uid: mapping.destinationEventUid,
});

const makeRemoteEvent = (mapping: EventMapping): RemoteEvent => ({
  deleteId: mapping.deleteIdentifier,
  endTime: mapping.endTime,
  isKeeperEvent: true,
  startTime: mapping.startTime,
  uid: mapping.destinationEventUid,
});

/*
 * Every real destination echoes back the uid the mapping already holds on an ordinary in-place
 * update: CalDAV returns generateDeterministicEventUid(event.id) - the same uid the create wrote -
 * Google returns getEchoedICalUid(body) ?? entry.uid, and Outlook returns updated.iCalUId, which
 * the create path seeded the mapping from. A double that answers with the source event id instead
 * makes every ordinary edit look like a brand new mirror, which is exactly the bug under test.
 */
const createEchoingDestination = (
  mappings: EventMapping[],
  updateOutcome: (mapping: EventMapping, update: EventUpdate) => PushResult,
) => {
  const mappingsByDeleteId = new Map(mappings.map((mapping) => [mapping.deleteIdentifier, mapping]));
  const pushedEvents: MaterializedSyncableEvent[] = [];
  const deletedIds: string[] = [];

  const answerUpdate = (update: EventUpdate): PushResult => {
    const mapping = mappingsByDeleteId.get(update.deleteId);
    if (!mapping) {
      return { error: "unknown target", errorType: "TestDoubleError", statusCode: 404, success: false };
    }
    return updateOutcome(mapping, update);
  };

  const provider: CalendarSyncProvider = {
    deleteEvents: (eventIds) => {
      deletedIds.push(...eventIds);
      return Promise.resolve(eventIds.map(() => ({ success: true })));
    },
    listRemoteEvents: () => Promise.resolve(mappings.map((mapping) => makeRemoteEvent(mapping))),
    pushEvents: (events) => {
      pushedEvents.push(...events);
      return Promise.resolve(events.map((event): PushResult => ({
        deleteId: `/calendar/${event.sourceEventUid}@keeper.sh.ics`,
        remoteId: `${event.sourceEventUid}@keeper.sh`,
        success: true,
      })));
    },
    updateEvents: (updates) => Promise.resolve(updates.map((update) => answerUpdate(update))),
  };

  return { deletedIds, provider, pushedEvents };
};

const acceptInPlace = (mapping: EventMapping, update: EventUpdate): PushResult => ({
  deleteId: update.deleteId,
  remoteId: mapping.destinationEventUid,
  success: true,
});

const rejectDurably = (): PushResult => ({
  error: "invalid payload",
  errorType: "MicrosoftGraphHttpError",
  statusCode: 400,
  success: false,
});

const runSyncCalendar = async (provider: CalendarSyncProvider, mappings: EventMapping[]) => {
  const emitted: Record<string, unknown>[] = [];
  const result = await syncCalendar({
    calendarId: DESTINATION_CALENDAR_ID,
    flush: () => Promise.resolve(),
    isCurrent: () => Promise.resolve(true),
    onSyncEvent: (event) => { emitted.push(event); },
    provider,
    readState: () => Promise.resolve({
      existingMappings: mappings,
      localEvents: EVENT_INDEXES.map((index) => makeEvent(index)),
      remoteEvents: mappings.map((mapping) => makeRemoteEvent(mapping)),
    }),
    reconciliationScope: TEST_RECONCILIATION_SCOPE,
    userId: "user-1",
  });
  expect(emitted).toHaveLength(1);
  return { result, wideEvent: emitted[0] as Record<string, unknown> };
};

describe("a successful in-place update counts as a successful operation", () => {
  it("reports three accepted in-place updates as successes the verdict can see, without counting an add", async () => {
    const mappings = EVENT_INDEXES.map((index) => makeMapping(index));
    const replacements = mappings.map((mapping, position) => makeReplacement(mapping, makeEvent(EVENT_INDEXES[position] as number)));
    const destination = createEchoingDestination(mappings, acceptInPlace);

    const outcome = await executeRemoteOperations(
      replacements,
      mappings,
      DESTINATION_CALENDAR_ID,
      destination.provider,
    );

    // Nothing new landed on a create-only destination, so an operator watching for duplicate churn sees nothing.
    expect(outcome.result.added).toBe(0);
    expect(destination.pushedEvents).toEqual([]);
    expect(destination.deletedIds).toEqual([]);

    // The three edits really happened, and the counters must carry that where the verdict reads them.
    expect(outcome.result.addFailed).toBe(0);
    expect(outcome.result.updated).toBe(EVENT_INDEXES.length);
    expect(outcome.errors).toEqual([]);
  });

  it("still counts an update the destination answered with a different mirror as an add", async () => {
    const mappings = [makeMapping(1)];
    const replacements = [makeReplacement(mappings[0] as EventMapping, makeEvent(1))];
    const destination = createEchoingDestination(mappings, (_mapping, update) => ({
      deleteId: update.deleteId,
      remoteId: "remote-1-recreated@keeper.sh",
      success: true,
    }));

    const outcome = await executeRemoteOperations(
      replacements,
      mappings,
      DESTINATION_CALENDAR_ID,
      destination.provider,
    );

    expect(outcome.result.added).toBe(1);
    expect(outcome.result.addFailed).toBe(0);
  });

  it("resolves a run that repaired two mirrors in place and lost one to a 400 as succeeded", async () => {
    const mappings = EVENT_INDEXES.map((index) => makeMapping(index));
    const destination = createEchoingDestination(mappings, (mapping, update) => {
      if (mapping.id === "map-3") {
        return rejectDurably();
      }
      return acceptInPlace(mapping, update);
    });

    const { result, wideEvent } = await runSyncCalendar(destination.provider, mappings);

    expect(result.added).toBe(0);
    expect(result.addFailed).toBe(1);
    expect(result.removed).toBe(0);
    expect(result.removeFailed).toBe(0);
    expect(destination.pushedEvents).toEqual([]);
    expect(destination.deletedIds).toEqual([]);

    // Exactly the call sync-user.ts makes before it escalates the destination backoff.
    const verdict = resolveDestinationAttemptVerdict(result, wideEvent["superseded"] === true);

    // 'failed' doubles the interval toward the six hour ceiling and only 'succeeded' ever resets it.
    expect(verdict).toBe("succeeded");
  });

  it("still resolves a run whose every update failed as failed", async () => {
    const mappings = EVENT_INDEXES.map((index) => makeMapping(index));
    const destination = createEchoingDestination(mappings, rejectDurably);

    const { result, wideEvent } = await runSyncCalendar(destination.provider, mappings);

    expect(result.added).toBe(0);
    expect(result.addFailed).toBe(EVENT_INDEXES.length);
    expect(result.updated).toBe(0);

    const verdict = resolveDestinationAttemptVerdict(result, wideEvent["superseded"] === true);

    expect(verdict).toBe("failed");
  });
});
