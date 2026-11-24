import { describe, expect, it } from "vitest";
import { syncCalendar } from "../../../src/core/sync-engine/index";
import type { MaterializedSyncableEvent } from "../../../src/core/types";
import type { EventMapping } from "../../../src/core/events/mappings";
import type { CalendarSyncProvider } from "../../../src/core/sync-engine/types";

const SCOPE = {
  authoritativeWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
  requestedWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
};

const event: MaterializedSyncableEvent = {
  calendarId: "cal-1",
  calendarName: "Test Calendar",
  calendarUrl: null,
  endTime: new Date("2026-03-15T10:00:00Z"),
  id: "ev-1",
  sourceEventUid: "uid-ev-1",
  startTime: new Date("2026-03-15T09:00:00Z"),
  summary: "Renamed",
};

const mapping: EventMapping = {
  calendarId: "dest-cal-1",
  deleteIdentifier: "/calendar/remote-1@keeper.sh.ics",
  destinationEventUid: "remote-1@keeper.sh",
  endTime: event.endTime,
  eventStateId: "ev-1",
  id: "map-1",
  sourceCalendarId: "cal-1",
  startTime: event.startTime,
  syncEventHash: "hash-of-the-previous-version",
  syncEventId: "ev-1",
};

const remoteEvent = {
  deleteId: mapping.deleteIdentifier,
  endTime: mapping.endTime,
  isKeeperEvent: true,
  startTime: mapping.startTime,
  uid: mapping.destinationEventUid,
};

const runReplacement = async (
  provider: CalendarSyncProvider,
): Promise<Record<string, unknown>> => {
  const emitted: Record<string, unknown>[] = [];
  await syncCalendar({
    calendarId: "dest-cal-1",
    flush: () => Promise.resolve(),
    isCurrent: () => Promise.resolve(true),
    onSyncEvent: (wideEvent) => emitted.push(wideEvent),
    provider,
    readState: () => Promise.resolve({
      existingMappings: [mapping],
      localEvents: [event],
      remoteEvents: [remoteEvent],
    }),
    reconciliationScope: SCOPE,
    userId: "user-1",
  });
  const [wideEvent] = emitted;
  if (!wideEvent) {
    throw new Error("syncCalendar emitted no wide event");
  }
  return wideEvent;
};

const succeedingDeletes: CalendarSyncProvider["deleteEvents"] = (ids) =>
  Promise.resolve(ids.map(() => ({ success: true })));

const succeedingPushes: CalendarSyncProvider["pushEvents"] = (events) =>
  Promise.resolve(events.map((pushed) => ({ remoteId: pushed.id, success: true })));

describe("the counts a replacement reports", () => {
  it("reports an in-place update as one replacement and one update, with nothing removed", async () => {
    const wideEvent = await runReplacement({
      deleteEvents: succeedingDeletes,
      listRemoteEvents: () => Promise.resolve([]),
      pushEvents: succeedingPushes,
      updateEvents: (updates) => Promise.resolve(updates.map((update) => ({
        deleteId: update.deleteId,
        remoteId: update.event.id,
        success: true,
      }))),
    });

    expect(wideEvent).toMatchObject({
      "events.added": 0,
      "events.removed": 0,
      "events.updated": 1,
      "operations.add_count": 0,
      "operations.remove_count": 0,
      "operations.replace_count": 1,
      "operations.total": 1,
    });
  });

  it("reports a replacement done by deleting and re-adding as one removal and one addition", async () => {
    const wideEvent = await runReplacement({
      deleteEvents: succeedingDeletes,
      listRemoteEvents: () => Promise.resolve([]),
      pushEvents: succeedingPushes,
    });

    expect(wideEvent).toMatchObject({
      "events.added": 1,
      "events.removed": 1,
      "events.updated": 0,
      "operations.replace_count": 1,
    });
  });
});
