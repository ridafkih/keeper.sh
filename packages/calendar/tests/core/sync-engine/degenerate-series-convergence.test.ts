import { describe, expect, it } from "vitest";
import type { GoogleEvent } from "@keeper.sh/data-schemas";
import { syncCalendar } from "../../../src/core/sync-engine/index";
import type { CalendarSyncProvider, PendingChanges } from "../../../src/core/sync-engine/types";
import type {
  EventMapping,
  MaterializedSyncableEvent,
  RemoteEvent,
  SyncableEvent,
} from "../../../src/index";
import { createEditableEventContentHash } from "../../../src/core/events/content-hash";
import { materializeRecurrenceEvents } from "../../../src/core/events/recurrence-materializer";
import { normalizeGoogleEvent } from "../../../src/providers/google/destination/normalize-event";
import { serializeGoogleEvent } from "../../../src/providers/google/destination/serialize-event";
import { parseEventTime as parseGoogleEventTime } from "../../../src/providers/google/shared/date-time";

const WINDOW = {
  end: new Date("2027-03-13T00:00:00.000Z"),
  start: new Date("2027-03-08T00:00:00.000Z"),
};

const SCOPE = {
  authoritativeWindow: { timeMax: WINDOW.end, timeMin: WINDOW.start },
  requestedWindow: { timeMax: WINDOW.end, timeMin: WINDOW.start },
};

const toAvailability = (isFree: boolean): "busy" | "free" => {
  if (isFree) {
    return "free";
  }
  return "busy";
};

const createGoogleHarness = (events: MaterializedSyncableEvent[]) => {
  const mappings: EventMapping[] = [];
  const stored = new Map<string, GoogleEvent & { id: string }>();
  const counters = { deletes: 0, nextRemoteId: 0 };

  const provider: CalendarSyncProvider = {
    deleteEvents: (eventIds) => {
      counters.deletes += eventIds.length;
      for (const eventId of eventIds) {
        stored.delete(eventId);
      }
      return Promise.resolve(eventIds.map(() => ({ success: true })));
    },
    listRemoteEvents: () => Promise.resolve([...stored.values()].flatMap((event): RemoteEvent[] => {
      const startTime = parseGoogleEventTime(event.start);
      const endTime = parseGoogleEventTime(event.end);
      if (!startTime || !endTime) {
        return [];
      }
      const availability = toAvailability(event.transparency === "transparent");
      return [{
        deleteId: event.id,
        editableAvailability: availability,
        editableContentHash: createEditableEventContentHash({
          availability,
          description: event.description,
          endTime,
          isAllDay: Boolean(event.start?.date),
          location: event.location,
          startTime,
          summary: event.summary ?? "",
        }),
        endTime,
        isKeeperEvent: true,
        startTime,
        supportedAvailabilities: ["busy", "free"],
        uid: event.iCalUID ?? "",
      }];
    })),
    normalizeEvent: normalizeGoogleEvent,
    pushEvents: (pushed) => Promise.resolve(pushed.map((event) => {
      const uid = `keeper-${event.id}`;
      const payload = serializeGoogleEvent(event, uid);
      if (!payload) {
        return { error: "not serializable", success: false as const };
      }
      counters.nextRemoteId += 1;
      const deleteId = `google-${counters.nextRemoteId}`;
      stored.set(deleteId, { ...payload, id: deleteId });
      return { deleteId, remoteId: uid, success: true as const };
    })),
  };

  return {
    get deletes() {
      return counters.deletes;
    },
    mappings,
    stored,
    runSync: () => syncCalendar({
      calendarId: "destination-calendar",
      flush: (changes: PendingChanges) => {
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
          } as EventMapping);
        }
        for (const deleted of changes.deletes) {
          const index = mappings.findIndex((mapping) => mapping.id === deleted);
          if (index !== -1) {
            mappings.splice(index, 1);
          }
        }
        return Promise.resolve();
      },
      isCurrent: () => Promise.resolve(true),
      provider,
      readState: async () => ({
        existingMappings: [...mappings],
        localEvents: events,
        remoteEvents: await provider.listRemoteEvents({ timeMin: SCOPE.requestedWindow.timeMin }),
      }),
      reconciliationScope: SCOPE,
      userId: "user-1",
    }),
  };
};

const buildSeries = (overrides: Partial<SyncableEvent>): SyncableEvent => ({
  availability: "busy",
  calendarId: "source-calendar",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2027-03-08T00:00:00.000Z"),
  eventStateId: "series-1",
  id: "series-1",
  recurrenceRule: { frequency: "DAILY" },
  sourceEventUid: "series-uid",
  startTime: new Date("2027-03-08T00:00:00.000Z"),
  startTimeZone: "UTC",
  summary: "Daily point in time",
  ...overrides,
} as SyncableEvent);

describe("zero-duration recurring series", () => {
  it("materializes every zero-duration occurrence inside the window", () => {
    const occurrences = materializeRecurrenceEvents([buildSeries({})], WINDOW);

    expect(occurrences).toHaveLength(5);
    for (const occurrence of occurrences) {
      expect(occurrence.endTime.getTime()).toBe(occurrence.startTime.getTime());
    }
  });

  it("mirrors every occurrence of a zero-duration series and converges", async () => {
    const occurrences = materializeRecurrenceEvents([buildSeries({})], WINDOW);
    const harness = createGoogleHarness(occurrences as MaterializedSyncableEvent[]);

    const first = await harness.runSync();
    const second = await harness.runSync();
    const third = await harness.runSync();

    expect(first.added).toBe(occurrences.length);
    expect(second).toMatchObject({ added: 0, removed: 0 });
    expect(third).toMatchObject({ added: 0, removed: 0 });
    expect(harness.stored.size).toBe(occurrences.length);
    expect(harness.deletes).toBe(0);
  });

  it("mirrors an inverted series whose occurrences all end before they start", async () => {
    const occurrences = materializeRecurrenceEvents([buildSeries({
      endTime: new Date("2027-03-07T23:00:00.000Z"),
      startTime: new Date("2027-03-08T00:00:00.000Z"),
    })], WINDOW);
    const harness = createGoogleHarness(occurrences as MaterializedSyncableEvent[]);

    const first = await harness.runSync();
    const second = await harness.runSync();
    const third = await harness.runSync();

    expect(occurrences.length).toBeGreaterThan(0);
    expect(first.added).toBe(occurrences.length);
    expect(second).toMatchObject({ added: 0, removed: 0 });
    expect(third).toMatchObject({ added: 0, removed: 0 });
    expect(harness.deletes).toBe(0);
  });
});
