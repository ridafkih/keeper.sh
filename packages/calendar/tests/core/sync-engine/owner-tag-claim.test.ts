import { describe, expect, it } from "vitest";
import { syncCalendar } from "../../../src/core/sync-engine/index";
import { createSyncEventContentHash } from "../../../src/core/events/content-hash";
import type { EventMapping } from "../../../src/core/events/mappings";
import type { MaterializedSyncableEvent, RemoteEvent } from "../../../src/core/types";
import type { CalendarSyncProvider, EventUpdate } from "../../../src/core/sync-engine/types";

const WINDOW = {
  timeMax: new Date("2100-01-01T00:00:00.000Z"),
  timeMin: new Date("2000-01-01T00:00:00.000Z"),
};

const event: MaterializedSyncableEvent = {
  calendarId: "cal-1",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2026-03-15T10:00:00Z"),
  id: "ev-1",
  sourceEventUid: "uid-ev-1",
  startTime: new Date("2026-03-15T09:00:00Z"),
  summary: "Meeting",
};

const mapping: EventMapping = {
  calendarId: "dest-cal-1",
  deleteIdentifier: "remote-1-id",
  destinationEventUid: "remote-1@keeper.sh",
  endTime: event.endTime,
  eventStateId: "ev-1",
  id: "map-1",
  sourceCalendarId: "cal-1",
  startTime: event.startTime,
  syncEventHash: createSyncEventContentHash(event),
  syncEventId: "ev-1",
};

const mirror = (ownerTag: string | null): RemoteEvent => ({
  deleteId: mapping.deleteIdentifier,
  endTime: mapping.endTime,
  isKeeperEvent: true,
  ownerTag,
  startTime: mapping.startTime,
  uid: mapping.destinationEventUid,
});

const runSync = async (remoteEvents: RemoteEvent[]) => {
  const claimed: EventUpdate[][] = [];
  const emitted: Record<string, unknown>[] = [];
  const provider: CalendarSyncProvider = {
    claimEvents: (updates) => {
      claimed.push(updates);
      return Promise.resolve(updates.map(() => ({ success: true })));
    },
    deleteEvents: (ids) => Promise.resolve(ids.map(() => ({ success: true }))),
    deriveEventUids: (local) => [`derived-${local.id}`],
    listRemoteEvents: () => Promise.resolve([]),
    ownerTag: "dest-cal-1",
    pushEvents: (events) => Promise.resolve(events.map(() => ({ success: true }))),
  };
  await syncCalendar({
    calendarId: "dest-cal-1",
    flush: () => Promise.resolve(),
    isCurrent: () => Promise.resolve(true),
    onSyncEvent: (wideEvent) => { emitted.push(wideEvent); },
    provider,
    readState: () => Promise.resolve({ existingMappings: [mapping], localEvents: [event], remoteEvents }),
    reconciliationScope: { authoritativeWindow: WINDOW, requestedWindow: WINDOW },
    userId: "user-1",
  });
  return { claimed, wideEvent: emitted[0] ?? {} };
};

describe("claiming mirrors written before ownership tags", () => {
  it("tags an in-sync untagged mirror without rewriting anything else", async () => {
    const { claimed, wideEvent } = await runSync([mirror(null)]);

    expect(claimed).toEqual([[{ deleteId: "remote-1-id", event }]]);
    expect(wideEvent["owner_tag.claimed_count"]).toBe(1);
    expect(wideEvent["outcome"]).toBe("in-sync");
  });

  it("leaves an already tagged mirror untouched", async () => {
    const { claimed } = await runSync([mirror("dest-cal-1")]);

    expect(claimed).toEqual([]);
  });
});
