import { describe, expect, it } from "vitest";
import { syncCalendar } from "../../../src/core/sync-engine/index";
import type { CalendarSyncProvider, PendingChanges } from "../../../src/core/sync-engine/types";
import type {
  EventMapping,
  MaterializedSyncableEvent,
  RemoteEvent,
} from "../../../src/index";
import { createEditableEventContentHash } from "../../../src/core/events/content-hash";
import { generateDeterministicEventUid } from "../../../src/core/events/identity";
import { normalizeCalDAVEvent } from "../../../src/providers/caldav/destination/normalize-event";
import {
  eventToICalString,
  parseICalCalendarsToRemoteEvents,
} from "../../../src/providers/caldav/shared/ics";

const DESTINATION_CALENDAR_ID = "destination-calendar";

interface Window {
  timeMax: Date;
  timeMin: Date;
}

const WIDE_SCOPE = {
  authoritativeWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  } satisfies Window,
  requestedWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  } satisfies Window,
};

const buildEvent = (
  overrides: Partial<MaterializedSyncableEvent>,
): MaterializedSyncableEvent => ({
  availability: "busy",
  calendarId: "source-calendar",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2027-03-08T16:00:00.500Z"),
  eventStateId: "event-state-1",
  id: "event-state-1",
  sourceEventUid: "source-uid",
  startTime: new Date("2027-03-08T16:00:00.500Z"),
  summary: "Sub-second point",
  ...overrides,
} as MaterializedSyncableEvent);

interface RunResult {
  added: number;
  addFailed: number;
  removed: number;
  removeFailed: number;
}

const SETTLED: RunResult = { addFailed: 0, added: 0, removeFailed: 0, removed: 0 };

const toRunCounts = (result: RunResult): RunResult => ({
  addFailed: result.addFailed,
  added: result.added,
  removeFailed: result.removeFailed,
  removed: result.removed,
});

const buildMappingFlush = (mappings: EventMapping[]) => (changes: PendingChanges) => {
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
};

const parseResource = (ics: string) => parseICalCalendarsToRemoteEvents([ics], {
  rejectUnsupportedRecurrenceDates: false,
}).events[0];

const createCalDAVHarness = (events: MaterializedSyncableEvent[]) => {
  const mappings: EventMapping[] = [];
  const resources = new Map<string, string>();
  const rejections: string[] = [];
  const counters = { deletes: 0, writes: 0 };

  const listRemoteEvents = (): Promise<RemoteEvent[]> => {
    const parsed = parseICalCalendarsToRemoteEvents([...resources.values()], {
      rejectUnsupportedRecurrenceDates: false,
    });
    return Promise.resolve(parsed.events.map((event): RemoteEvent => ({
      deleteId: event.uid,
      editableAvailability: event.availability,
      editableContentHash: createEditableEventContentHash({
        availability: event.availability,
        description: event.description,
        endTime: event.endTime,
        isAllDay: event.isAllDay,
        location: event.location,
        startTime: event.startTime,
        summary: event.title ?? "",
      }),
      endTime: event.endTime,
      isKeeperEvent: true,
      startTime: event.startTime,
      supportedAvailabilities: ["busy", "free"],
      uid: event.uid,
    })));
  };

  const provider: CalendarSyncProvider = {
    deleteEvents: (eventIds) => {
      counters.deletes += eventIds.length;
      for (const eventId of eventIds) {
        resources.delete(eventId);
      }
      return Promise.resolve(eventIds.map(() => ({ success: true })));
    },
    listRemoteEvents,
    normalizeEvent: normalizeCalDAVEvent,
    pushEvents: (pushed) => Promise.resolve(pushed.map((event) => {
      const uid = generateDeterministicEventUid(event.id);
      const iCalString = eventToICalString(event, uid);
      const parsed = parseResource(iCalString);
      if (!parsed || parsed.endTime.getTime() <= parsed.startTime.getTime()) {
        rejections.push(iCalString);
        return { success: false as const, error: "RFC 5545 §3.6.1: DTEND must follow DTSTART" };
      }
      counters.writes += 1;
      resources.set(uid, iCalString);
      return { deleteId: uid, remoteId: uid, success: true as const };
    })),
  };

  return {
    deletes: () => counters.deletes,
    mappings,
    rejections,
    remoteRanges: () => [...resources.values()].flatMap((ics) => {
      const parsed = parseResource(ics);
      if (!parsed) {
        return [];
      }
      return [{ end: parsed.endTime.toISOString(), start: parsed.startTime.toISOString() }];
    }),
    runSync: () => syncCalendar({
      calendarId: DESTINATION_CALENDAR_ID,
      flush: buildMappingFlush(mappings),
      isCurrent: () => Promise.resolve(true),
      provider,
      readState: async () => ({
        existingMappings: [...mappings],
        localEvents: events,
        remoteEvents: await listRemoteEvents(),
      }),
      reconciliationScope: WIDE_SCOPE,
      userId: "user-1",
    }),
    writes: () => counters.writes,
  };
};

const SHAPES: { event: MaterializedSyncableEvent; name: string }[] = [
  {
    event: buildEvent({
      endTime: new Date("2027-03-08T16:00:00.500Z"),
      startTime: new Date("2027-03-08T16:00:00.500Z"),
    }),
    name: "a zero-duration range on a sub-second instant",
  },
  {
    event: buildEvent({
      endTime: new Date("2027-03-08T15:59:59.500Z"),
      startTime: new Date("2027-03-08T16:00:00.500Z"),
    }),
    name: "an inverted range on a sub-second instant",
  },
  {
    event: buildEvent({
      endTime: new Date("2027-03-08T17:00:00.500Z"),
      startTime: new Date("2027-03-08T16:00:00.500Z"),
    }),
    name: "an ordinary hour-long range on a sub-second instant",
  },
];

describe("a stored range carrying milliseconds mirrored to CalDAV", () => {
  for (const shape of SHAPES) {
    it(`settles after one write for ${shape.name}`, async () => {
      const harness = createCalDAVHarness([shape.event]);

      const first = toRunCounts(await harness.runSync());
      const second = toRunCounts(await harness.runSync());
      const third = toRunCounts(await harness.runSync());
      const fourth = toRunCounts(await harness.runSync());

      expect(harness.rejections).toEqual([]);
      expect(first).toEqual({ ...SETTLED, added: 1 });
      expect([second, third, fourth]).toEqual([SETTLED, SETTLED, SETTLED]);
      expect(harness.writes()).toBe(1);
      expect(harness.deletes()).toBe(0);
      expect(harness.remoteRanges()).toHaveLength(1);
    });
  }
});
