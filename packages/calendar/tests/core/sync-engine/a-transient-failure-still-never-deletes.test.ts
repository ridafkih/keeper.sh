import { describe, expect, it } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import type { CalendarSyncProvider, EventUpdate } from "../../../src/core/sync-engine/types";
import type { MaterializedSyncableEvent, PushResult, SyncOperation } from "../../../src/core/types";
import type { EventMapping } from "../../../src/core/events/mappings";

const DESTINATION_CALENDAR_ID = "dest-cal-1";
const START_TIME = new Date("2026-03-15T09:00:00Z");
const END_TIME = new Date("2026-03-15T10:00:00Z");

const makeEvent = (): MaterializedSyncableEvent => ({
  id: "ev-1",
  sourceEventUid: "uid-ev-1",
  startTime: START_TIME,
  endTime: END_TIME,
  summary: "Dentist renamed",
  calendarId: "cal-1",
  calendarName: "Test Calendar",
  calendarUrl: null,
});

const makeMapping = (): EventMapping => ({
  id: "map-1",
  eventStateId: "ev-1",
  syncEventId: "ev-1",
  calendarId: DESTINATION_CALENDAR_ID,
  sourceCalendarId: "cal-1",
  destinationEventUid: "remote-1@keeper.sh",
  deleteIdentifier: "/calendar/remote-1@keeper.sh.ics",
  syncEventHash: "stale-hash",
  startTime: START_TIME,
  endTime: END_TIME,
});

const makeReplacement = (): Extract<SyncOperation, { type: "replace" }> => ({
  type: "replace",
  event: makeEvent(),
  staleMappingId: "map-1",
  uid: "remote-1@keeper.sh",
  deleteId: "/calendar/remote-1@keeper.sh.ics",
});

type UpdateBehaviour = (updates: EventUpdate[]) => Promise<PushResult[]>;

const createProvider = (updateBehaviour: UpdateBehaviour) => {
  const deleteCalls: string[][] = [];
  const pushCalls: MaterializedSyncableEvent[][] = [];

  const provider: CalendarSyncProvider = {
    deleteEvents: (eventIds) => {
      deleteCalls.push(eventIds);
      return Promise.resolve(eventIds.map(() => ({ success: true })));
    },
    listRemoteEvents: () => Promise.resolve([]),
    pushEvents: (events) => {
      pushCalls.push(events);
      return Promise.resolve(events.map((event): PushResult => ({
        success: true,
        remoteId: `${event.sourceEventUid}@keeper.sh`,
        deleteId: `/calendar/${event.sourceEventUid}@keeper.sh.ics`,
      })));
    },
    updateEvents: updateBehaviour,
  };

  return { deleteCalls, provider, pushCalls };
};

const respondsWith = (result: PushResult): UpdateBehaviour =>
  (updates) => Promise.resolve(updates.map(() => result));

const throwsNetworkError: UpdateBehaviour = () => Promise.reject(new TypeError("fetch failed: socket hang up"));

const transientFailures: { behaviour: UpdateBehaviour; label: string }[] = [
  {
    behaviour: respondsWith({ success: false, error: "service unavailable", errorType: "GoogleApiError", statusCode: 503 }),
    label: "a server error",
  },
  {
    behaviour: respondsWith({ success: false, error: "too many requests", errorType: "GoogleApiError", statusCode: 429 }),
    label: "a throttle",
  },
  {
    behaviour: respondsWith({ success: false, error: "the request timed out", errorType: "RequestTimeoutError" }),
    label: "a timeout",
  },
  {
    behaviour: throwsNetworkError,
    label: "a thrown network error",
  },
];

describe("a transient failure still never deletes", () => {
  for (const failure of transientFailures) {
    it(`leaves the event in place and reports the failure after ${failure.label}`, async () => {
      const { deleteCalls, provider, pushCalls } = createProvider(failure.behaviour);

      const outcome = await executeRemoteOperations(
        [makeReplacement()],
        [makeMapping()],
        DESTINATION_CALENDAR_ID,
        provider,
      );

      expect(deleteCalls).toEqual([]);
      expect(pushCalls).toEqual([]);
      expect(outcome.changes.inserts).toEqual([]);
      expect(outcome.changes.deletes).toEqual([]);
      expect(outcome.changes.updates ?? []).toEqual([]);
      expect(outcome.updateFallbacks).toBe(0);
      expect(outcome.result.removed).toBe(0);
      expect(outcome.result.added).toBe(0);
      expect(outcome.result.addFailed).toBe(1);
      expect(outcome.errors).toHaveLength(1);
      expect(outcome.errors[0]?.type).toBe("update");
    });
  }
});
