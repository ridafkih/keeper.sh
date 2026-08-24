import { describe, expect, it } from "vitest";
import { syncCalendar } from "../../../src/core/sync-engine/index";
import type { CalendarSyncProvider, PendingChanges } from "../../../src/core/sync-engine/types";
import type {
  EventMapping,
  MaterializedSyncableEvent,
  RemoteEvent,
} from "../../../src/index";
import { createEditableEventContentHash } from "../../../src/core/events/content-hash";
import { normalizeGoogleEvent } from "../../../src/providers/google/destination/normalize-event";

const DESTINATION_CALENDAR_ID = "destination-calendar";
const POINT_IN_TIME_START = new Date("2027-03-08T16:00:00.000Z");
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

const zeroDurationEvent: MaterializedSyncableEvent = {
  calendarId: "source-calendar",
  calendarName: "Source",
  calendarUrl: null,
  endTime: POINT_IN_TIME_START,
  eventStateId: "event-state-1",
  id: "event-state-1",
  sourceEventUid: "source-uid",
  startTime: POINT_IN_TIME_START,
  summary: "Point in time",
};

const createHarness = () => {
  const mappings: EventMapping[] = [];
  const remoteEvents: RemoteEvent[] = [];
  const pushedRanges: { startTime: Date; endTime: Date }[] = [];

  const provider: CalendarSyncProvider = {
    deleteEvents: (eventIds) => {
      for (const eventId of eventIds) {
        const index = remoteEvents.findIndex((remote) => remote.deleteId === eventId);
        if (index !== -1) {
          remoteEvents.splice(index, 1);
        }
      }
      return Promise.resolve(eventIds.map(() => ({ success: true })));
    },
    listRemoteEvents: () => Promise.resolve([...remoteEvents]),
    normalizeEvent: normalizeGoogleEvent,
    pushEvents: (events) => Promise.resolve(events.map((event, index) => {
      pushedRanges.push({ endTime: event.endTime, startTime: event.startTime });
      const stored = normalizeGoogleEvent(event);
      const remoteId = `remote-${index}`;
      remoteEvents.push({
        deleteId: remoteId,
        editableAvailability: "busy",
        editableContentHash: createEditableEventContentHash(stored),
        endTime: stored.endTime,
        isKeeperEvent: true,
        startTime: stored.startTime,
        supportedAvailabilities: ["busy", "free"],
        uid: remoteId,
      });
      return { remoteId, deleteId: remoteId, success: true };
    })),
  };

  const flush = (changes: PendingChanges): Promise<void> => {
    for (const insert of changes.inserts) {
      mappings.push({
        calendarId: insert.calendarId,
        deleteIdentifier: insert.deleteIdentifier,
        destinationEventUid: insert.destinationEventUid,
        endTime: insert.endTime,
        eventStateId: insert.eventStateId,
        id: `mapping-${mappings.length}`,
        sourceCalendarId: insert.sourceCalendarId,
        startTime: insert.startTime,
        syncEventHash: insert.syncEventHash,
        syncEventId: insert.syncEventId,
      });
    }
    for (const deleted of changes.deletes) {
      const index = mappings.findIndex((mapping) => mapping.id === deleted);
      if (index !== -1) {
        mappings.splice(index, 1);
      }
    }
    return Promise.resolve();
  };

  const runSync = () => syncCalendar({
    calendarId: DESTINATION_CALENDAR_ID,
    flush,
    isCurrent: () => Promise.resolve(true),
    provider,
    readState: () => Promise.resolve({
      existingMappings: [...mappings],
      localEvents: [zeroDurationEvent],
      remoteEvents: [...remoteEvents],
    }),
    reconciliationScope: TEST_RECONCILIATION_SCOPE,
    userId: "user-1",
  });

  return { mappings, pushedRanges, remoteEvents, runSync };
};

describe("syncCalendar applies the provider's destination normalization", () => {
  it("pushes and maps the range the destination will actually hold", async () => {
    const harness = createHarness();

    const result = await harness.runSync();

    expect(result.added).toBe(1);
    expect(harness.pushedRanges).toEqual([{
      endTime: new Date("2027-03-08T16:01:00.000Z"),
      startTime: POINT_IN_TIME_START,
    }]);
    expect(harness.mappings[0]?.startTime).toEqual(POINT_IN_TIME_START);
    expect(harness.mappings[0]?.endTime).toEqual(new Date("2027-03-08T16:01:00.000Z"));
  });

  it("leaves the mirrored event alone on the next run instead of replacing it", async () => {
    const harness = createHarness();
    await harness.runSync();

    const second = await harness.runSync();

    expect(second).toMatchObject({ added: 0, addFailed: 0, removed: 0, removeFailed: 0 });
    expect(harness.pushedRanges).toHaveLength(1);
    expect(harness.remoteEvents).toHaveLength(1);
    expect(harness.mappings).toHaveLength(1);
  });
});
