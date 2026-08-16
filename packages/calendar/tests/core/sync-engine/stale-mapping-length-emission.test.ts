import { describe, expect, it } from "vitest";
import { syncCalendar } from "../../../src/core/sync-engine/index";
import {
  createEditableEventContentSnapshot,
  createSyncEventContentHash,
  hashEditableEventContentSnapshot,
} from "../../../src/core/events/content-hash";
import type { EventMapping } from "../../../src/core/events/mappings";
import type { MaterializedSyncableEvent, RemoteEvent } from "../../../src/core/types";

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
  calendarId: "cal-1",
  calendarName: "Test Calendar",
  calendarUrl: null,
  description: "agenda for the sync",
  endTime: new Date("2026-03-15T10:00:00Z"),
  id: "ev-1",
  sourceEventUid: "uid-ev-1",
  startTime: new Date("2026-03-15T09:00:00Z"),
  summary: "Event ev-1",
};

const mapping: EventMapping = {
  calendarId: "dest-cal-1",
  deleteIdentifier: "remote-1",
  destinationEventUid: "remote-1",
  endTime: localEvent.endTime,
  eventStateId: localEvent.id,
  id: "map-1",
  sourceCalendarId: "cal-1",
  startTime: localEvent.startTime,
  syncEventHash: createSyncEventContentHash(localEvent),
  syncEventId: localEvent.id,
};

const runSync = async (remoteDescription: string): Promise<Record<string, unknown>> => {
  const rewrittenContent = createEditableEventContentSnapshot({
    ...localEvent,
    description: remoteDescription,
  });
  const remoteEvent: RemoteEvent = {
    deleteId: mapping.deleteIdentifier,
    editableAvailability: "busy",
    editableContent: rewrittenContent,
    editableContentHash: hashEditableEventContentSnapshot(rewrittenContent),
    endTime: localEvent.endTime,
    isKeeperEvent: true,
    startTime: localEvent.startTime,
    uid: mapping.destinationEventUid,
  };
  const emitted: Record<string, unknown>[] = [];

  await syncCalendar({
    calendarId: "dest-cal-1",
    flush: () => Promise.resolve(),
    isCurrent: () => Promise.resolve(true),
    onSyncEvent: (event) => { emitted.push(event); },
    provider: {
      deleteEvents: () => Promise.resolve([{ success: true }]),
      listRemoteEvents: () => Promise.resolve({ items: [], rawItemCount: 0 }),
      pushEvents: () => Promise.resolve([{ remoteId: "remote-new", success: true }]),
    },
    readState: () => Promise.resolve({
      existingMappings: [mapping],
      localEvents: [localEvent],
      remoteEvents: [remoteEvent],
      remoteRawItemCount: 1,
    }),
    reconciliationScope: TEST_RECONCILIATION_SCOPE,
    userId: "user-1",
  });

  expect(emitted).toHaveLength(1);
  return emitted[0] as Record<string, unknown>;
};

describe("stale mapping remote content length emission", () => {
  it("emits local and remote description length totals on the wide event", async () => {
    const event = await runSync("agenda");

    expect(event["stale_mappings.remote_content_description_changed_count"]).toBe(1);
    expect(event["stale_mappings.remote_content_description_local_length_total"]).toBe(19);
    expect(event["stale_mappings.remote_content_description_remote_length_total"]).toBe(6);
  });

  it("emits a zero remote total when the remote emptied the description", async () => {
    const event = await runSync("");

    expect(event["stale_mappings.remote_content_description_local_length_total"]).toBe(19);
    expect(event["stale_mappings.remote_content_description_remote_length_total"]).toBe(0);
  });

  it("emits no length fields for fields the remote left alone", async () => {
    const event = await runSync("agenda");

    expect(event["stale_mappings.remote_content_summary_local_length_total"]).toBeUndefined();
    expect(event["stale_mappings.remote_content_summary_remote_length_total"]).toBeUndefined();
    expect(event["stale_mappings.remote_content_location_local_length_total"]).toBeUndefined();
  });
});
