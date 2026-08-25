import { describe, expect, it } from "vitest";
import { syncCalendar } from "../../../src/core/sync-engine/index";
import type { CalendarSyncProvider } from "../../../src/core/sync-engine/types";
import type {
  EventPresence,
  EventVerificationTarget,
  MaterializedSyncableEvent,
  PushResult,
} from "../../../src/core/types";
import type { EventMapping } from "../../../src/core/events/mappings";

const DESTINATION_CALENDAR_ID = "dest-cal-1";
/* Graph item ids are opaque and re-keyable, so the mapped id is the only handle a delete has. */
const MAPPED_ID = "AAMkAGRemoteOne";
const MIRROR_UID = "mirror-uid-1";

const START_TIME = new Date("2026-09-01T15:00:00.000Z");
const END_TIME = new Date("2026-09-01T16:00:00.000Z");

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

const localEvent: MaterializedSyncableEvent = {
  calendarId: "source-cal-1",
  calendarName: "Work",
  calendarUrl: null,
  endTime: END_TIME,
  id: "sync-event-1",
  sourceEventUid: "source-uid-1",
  startTime: START_TIME,
  summary: "Quarterly review",
};

const mapping: EventMapping = {
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier: MAPPED_ID,
  destinationEventUid: MIRROR_UID,
  endTime: END_TIME,
  eventStateId: "sync-event-1",
  id: "mapping-1",
  sourceCalendarId: "source-cal-1",
  startTime: START_TIME,
  syncEventHash: null,
  syncEventId: "sync-event-1",
};

/* Shaped like the real Outlook destination: Graph answers a delete of an object the recipient
   already removed with a 404, which the provider maps to a bare success carrying no removedObject,
   and its create is a create-only POST that would leave a permanent duplicate. */
const createOutlookShapedProvider = () => {
  const calls: string[] = [];

  const provider: CalendarSyncProvider = {
    deleteEvents: (eventIds) => {
      calls.push(`delete:${eventIds.join(",")}`);
      return Promise.resolve(eventIds.map((): PushResult => ({ success: true })));
    },
    listRemoteEvents: () => Promise.resolve([]),
    pushEvents: (events) => {
      calls.push(`push:${events.length}`);
      return Promise.resolve(events.map((event): PushResult => ({
        deleteId: `AAMkAGcreated-${event.sourceEventUid}`,
        remoteId: `${event.sourceEventUid}@keeper.sh`,
        success: true,
      })));
    },
    /* The real Outlook destination PATCHes a live mirror in place, so a double without this
       would route the replacement down a delete-then-add path production never takes. */
    updateEvents: (updates) => {
      calls.push(`update:${updates.length}`);
      return Promise.resolve(updates.map((update): PushResult => ({
        deleteId: update.deleteId,
        remoteId: update.event.id,
        success: true,
      })));
    },
    verifyEventsExist: (targets: EventVerificationTarget[]) => {
      calls.push("verify");
      return Promise.resolve(targets.map((target): EventPresence => ({
        identifier: target.deleteId,
        status: "absent",
      })));
    },
  };

  return { calls, provider };
};

const runSyncCalendar = (provider: CalendarSyncProvider) =>
  syncCalendar({
    calendarId: DESTINATION_CALENDAR_ID,
    flush: () => Promise.resolve(),
    isCurrent: () => Promise.resolve(true),
    provider,
    readState: () => Promise.resolve({
      existingMappings: [mapping],
      localEvents: [localEvent],
      // The recipient deleted the mirror, so the windowed listing no longer holds it.
      remoteEvents: [],
    }),
    reconciliationScope: TEST_RECONCILIATION_SCOPE,
    userId: "user-1",
  });

describe("the timed provider forwards the verification capability", () => {
  it("verifies and recreates a recipient-deleted mirror without issuing a speculative delete", async () => {
    const { calls, provider } = createOutlookShapedProvider();

    const result = await runSyncCalendar(provider);

    expect(calls).toContain("verify");
    expect(calls).toContain("push:1");
    expect(calls.filter((call) => call.startsWith("delete:"))).toEqual([]);
    expect(result.added).toBe(1);
  });
});
