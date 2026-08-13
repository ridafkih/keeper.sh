import { describe, expect, it } from "vitest";
import type { GoogleEvent, OutlookEvent } from "@keeper.sh/data-schemas";
import { syncCalendar } from "../../../src/core/sync-engine/index";
import type { CalendarSyncProvider, PendingChanges } from "../../../src/core/sync-engine/types";
import type {
  EventMapping,
  MaterializedSyncableEvent,
  RemoteEvent,
  SyncableEvent,
} from "../../../src/index";
import { createEditableEventContentHash } from "../../../src/core/events/content-hash";
import { generateDeterministicEventUid } from "../../../src/core/events/identity";
import { materializeRecurrenceEvents } from "../../../src/core/events/recurrence-materializer";
import { normalizeCalDAVEvent } from "../../../src/providers/caldav/destination/normalize-event";
import { normalizeGoogleEvent } from "../../../src/providers/google/destination/normalize-event";
import { normalizeOutlookEvent } from "../../../src/providers/outlook/destination/normalize-event";
import { serializeGoogleEvent } from "../../../src/providers/google/destination/serialize-event";
import { serializeOutlookEvent } from "../../../src/providers/outlook/destination/serialize-event";
import { parseEventTime as parseGoogleEventTime } from "../../../src/providers/google/shared/date-time";
import { parseEventTime as parseOutlookEventTime } from "../../../src/providers/outlook/shared/date-time";
import {
  eventToICalString,
  parseICalCalendarsToRemoteEvents,
} from "../../../src/providers/caldav/shared/ics";

const DESTINATION_CALENDAR_ID = "destination-calendar";
const MS_PER_DAY = 86_400_000;
const WINDOW_DAYS = 30;

interface Window {
  timeMax: Date;
  timeMin: Date;
}

interface RunCounts {
  addFailed: number;
  added: number;
  removeFailed: number;
  removed: number;
}

const SETTLED: RunCounts = { addFailed: 0, added: 0, removeFailed: 0, removed: 0 };
const RETIRED: RunCounts = { addFailed: 0, added: 0, removeFailed: 0, removed: 1 };
const MIRRORED: RunCounts = { addFailed: 0, added: 1, removeFailed: 0, removed: 0 };

const buildWindow = (timeMin: Date): Window => ({
  timeMax: new Date(timeMin.getTime() + WINDOW_DAYS * MS_PER_DAY),
  timeMin,
});

const buildEvent = (overrides: Partial<SyncableEvent>): SyncableEvent => ({
  availability: "busy",
  calendarId: "source-calendar",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2027-03-08T00:00:00.000Z"),
  eventStateId: "event-state-1",
  id: "event-state-1",
  sourceEventUid: "source-uid",
  startTime: new Date("2027-03-08T00:00:00.000Z"),
  summary: "Point in time",
  ...overrides,
} as SyncableEvent);

const toAvailability = (isFree: boolean): "busy" | "free" => {
  if (isFree) {
    return "free";
  }
  return "busy";
};

interface Harness {
  runSync: (window: Window) => Promise<RunCounts>;
  deletes: () => number;
  remoteCount: () => number;
  remoteRanges: () => string[];
  writes: () => number;
}

type HarnessFactory = (rows: SyncableEvent[]) => Harness;

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

const readLocalEvents = (
  rows: SyncableEvent[],
  window: Window,
): MaterializedSyncableEvent[] => materializeRecurrenceEvents(rows, {
  end: window.timeMax,
  start: window.timeMin,
});

const toRunCounts = (result: RunCounts): RunCounts => ({
  addFailed: result.addFailed,
  added: result.added,
  removeFailed: result.removeFailed,
  removed: result.removed,
});

const createGoogleHarness: HarnessFactory = (rows) => {
  const mappings: EventMapping[] = [];
  const stored = new Map<string, GoogleEvent & { id: string }>();
  const counters = { deletes: 0, writes: 0 };

  const listRemoteEvents = (timeMin: Date): Promise<RemoteEvent[]> =>
    Promise.resolve([...stored.values()].flatMap((event): RemoteEvent[] => {
      const startTime = parseGoogleEventTime(event.start);
      const endTime = parseGoogleEventTime(event.end);
      if (!startTime || !endTime || endTime <= timeMin) {
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
    }));

  const provider: CalendarSyncProvider = {
    deleteEvents: (eventIds) => {
      counters.deletes += eventIds.length;
      for (const eventId of eventIds) {
        stored.delete(eventId);
      }
      return Promise.resolve(eventIds.map(() => ({ success: true })));
    },
    listRemoteEvents: (options) => listRemoteEvents(options.timeMin),
    normalizeEvent: normalizeGoogleEvent,
    pushEvents: (pushed) => Promise.resolve(pushed.map((event) => {
      const uid = generateDeterministicEventUid(event.id);
      const payload = serializeGoogleEvent(event, uid);
      if (!payload) {
        return { error: "not serializable", success: false as const };
      }
      counters.writes += 1;
      stored.set(uid, { ...payload, id: uid });
      return { deleteId: uid, remoteId: uid, success: true as const };
    })),
  };

  return {
    deletes: () => counters.deletes,
    remoteCount: () => stored.size,
    remoteRanges: () => [...stored.values()].map((event) =>
      `${parseGoogleEventTime(event.start)?.toISOString()}/${parseGoogleEventTime(event.end)?.toISOString()}`),
    runSync: async (window) => toRunCounts(await syncCalendar({
      calendarId: DESTINATION_CALENDAR_ID,
      flush: buildMappingFlush(mappings),
      isCurrent: () => Promise.resolve(true),
      provider,
      readState: async () => ({
        existingMappings: [...mappings],
        localEvents: readLocalEvents(rows, window),
        remoteEvents: await listRemoteEvents(window.timeMin),
      }),
      reconciliationScope: { authoritativeWindow: window, requestedWindow: window },
      userId: "user-1",
    })),
    writes: () => counters.writes,
  };
};

const createOutlookHarness: HarnessFactory = (rows) => {
  const mappings: EventMapping[] = [];
  const stored = new Map<string, OutlookEvent & { id: string }>();
  const counters = { deletes: 0, writes: 0 };

  const listRemoteEvents = (timeMin: Date): Promise<RemoteEvent[]> =>
    Promise.resolve([...stored.values()].flatMap((event): RemoteEvent[] => {
      const isAllDay = event.isAllDay ?? false;
      const startTime = parseOutlookEventTime(event.start, isAllDay);
      const endTime = parseOutlookEventTime(event.end, isAllDay);
      if (!startTime || !endTime || endTime < timeMin) {
        return [];
      }
      const availability = toAvailability(event.showAs === "free");
      return [{
        deleteId: event.id,
        editableAvailability: availability,
        editableContentHash: createEditableEventContentHash({
          availability,
          description: event.body?.content,
          endTime,
          isAllDay,
          location: event.location?.displayName,
          startTime,
          summary: event.subject ?? "",
        }),
        endTime,
        isKeeperEvent: true,
        startTime,
        supportedAvailabilities: ["busy", "free"],
        uid: event.iCalUId ?? "",
      }];
    }));

  const provider: CalendarSyncProvider = {
    deleteEvents: (eventIds) => {
      counters.deletes += eventIds.length;
      for (const eventId of eventIds) {
        stored.delete(eventId);
      }
      return Promise.resolve(eventIds.map(() => ({ success: true })));
    },
    listRemoteEvents: (options) => listRemoteEvents(options.timeMin),
    normalizeEvent: normalizeOutlookEvent,
    pushEvents: (pushed) => Promise.resolve(pushed.map((event) => {
      const uid = generateDeterministicEventUid(event.id);
      const payload = { ...serializeOutlookEvent(event), iCalUId: uid };
      counters.writes += 1;
      stored.set(uid, { ...payload, id: uid });
      return { deleteId: uid, remoteId: uid, success: true as const };
    })),
  };

  return {
    deletes: () => counters.deletes,
    remoteCount: () => stored.size,
    remoteRanges: () => [...stored.values()].map((event) => {
      const isAllDay = event.isAllDay ?? false;
      return `${parseOutlookEventTime(event.start, isAllDay)?.toISOString()}/${parseOutlookEventTime(event.end, isAllDay)?.toISOString()}`;
    }),
    runSync: async (window) => toRunCounts(await syncCalendar({
      calendarId: DESTINATION_CALENDAR_ID,
      flush: buildMappingFlush(mappings),
      isCurrent: () => Promise.resolve(true),
      provider,
      readState: async () => ({
        existingMappings: [...mappings],
        localEvents: readLocalEvents(rows, window),
        remoteEvents: await listRemoteEvents(window.timeMin),
      }),
      reconciliationScope: { authoritativeWindow: window, requestedWindow: window },
      userId: "user-1",
    })),
    writes: () => counters.writes,
  };
};

const parseResource = (ics: string) => parseICalCalendarsToRemoteEvents([ics], {
  rejectUnsupportedRecurrenceDates: false,
}).events[0];

const createCalDAVHarness: HarnessFactory = (rows) => {
  const mappings: EventMapping[] = [];
  const resources = new Map<string, string>();
  const counters = { deletes: 0, writes: 0 };

  const listRemoteEvents = (timeMin: Date): Promise<RemoteEvent[]> => {
    const parsed = parseICalCalendarsToRemoteEvents([...resources.values()], {
      rejectUnsupportedRecurrenceDates: false,
    });
    return Promise.resolve(parsed.events.flatMap((event): RemoteEvent[] => {
      if (event.endTime < timeMin) {
        return [];
      }
      return [{
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
      }];
    }));
  };

  const provider: CalendarSyncProvider = {
    deleteEvents: (eventIds) => {
      counters.deletes += eventIds.length;
      for (const eventId of eventIds) {
        resources.delete(eventId);
      }
      return Promise.resolve(eventIds.map(() => ({ success: true })));
    },
    listRemoteEvents: (options) => listRemoteEvents(options.timeMin),
    normalizeEvent: normalizeCalDAVEvent,
    pushEvents: (pushed) => Promise.resolve(pushed.map((event) => {
      const uid = generateDeterministicEventUid(event.id);
      const iCalString = eventToICalString(event, uid);
      const parsed = parseResource(iCalString);
      if (!parsed || parsed.endTime.getTime() <= parsed.startTime.getTime()) {
        return { error: "RFC 5545 §3.6.1: DTEND must follow DTSTART", success: false as const };
      }
      counters.writes += 1;
      resources.set(uid, iCalString);
      return { deleteId: uid, remoteId: uid, success: true as const };
    })),
  };

  return {
    deletes: () => counters.deletes,
    remoteCount: () => resources.size,
    remoteRanges: () => [...resources.values()].flatMap((ics) => {
      const parsed = parseResource(ics);
      if (!parsed) {
        return [];
      }
      return [`${parsed.startTime.toISOString()}/${parsed.endTime.toISOString()}`];
    }),
    runSync: async (window) => toRunCounts(await syncCalendar({
      calendarId: DESTINATION_CALENDAR_ID,
      flush: buildMappingFlush(mappings),
      isCurrent: () => Promise.resolve(true),
      provider,
      readState: async () => ({
        existingMappings: [...mappings],
        localEvents: readLocalEvents(rows, window),
        remoteEvents: await listRemoteEvents(window.timeMin),
      }),
      reconciliationScope: { authoritativeWindow: window, requestedWindow: window },
      userId: "user-1",
    })),
    writes: () => counters.writes,
  };
};

const destinations: [string, HarnessFactory][] = [
  ["google", createGoogleHarness],
  ["outlook", createOutlookHarness],
  ["caldav", createCalDAVHarness],
];

const EDGE_DAY = new Date("2027-03-08T00:00:00.000Z");
const NEXT_DAY = new Date("2027-03-09T00:00:00.000Z");
const DAY_AFTER = new Date("2027-03-10T00:00:00.000Z");

const shapes: [string, Partial<SyncableEvent>][] = [
  ["zero-duration on the window's lower edge", {
    endTime: EDGE_DAY,
    startTime: EDGE_DAY,
  }],
  ["inverted range starting on the window's lower edge", {
    endTime: new Date("2027-02-20T09:00:00.000Z"),
    startTime: EDGE_DAY,
  }],
  ["same-date all-day event on the window's lower edge", {
    endTime: EDGE_DAY,
    isAllDay: true,
    startTime: EDGE_DAY,
  }],
];

describe.each(destinations)("%s mirrors a degenerate range as the window slides", (
  _name,
  createHarness,
) => {
  it.each(shapes)("settles, then retires exactly once, for a %s", async (_shape, overrides) => {
    const harness = createHarness([buildEvent(overrides)]);

    const firstRun = await harness.runSync(buildWindow(EDGE_DAY));
    const secondRun = await harness.runSync(buildWindow(EDGE_DAY));
    const thirdRun = await harness.runSync(buildWindow(EDGE_DAY));
    const rangesWhileInsideWindow = harness.remoteRanges();

    expect(firstRun).toEqual(MIRRORED);
    expect(secondRun).toEqual(SETTLED);
    expect(thirdRun).toEqual(SETTLED);
    expect(harness.remoteCount()).toBe(1);
    expect(harness.writes()).toBe(1);
    expect(harness.deletes()).toBe(0);

    const slidRun = await harness.runSync(buildWindow(NEXT_DAY));
    const slidAgainRun = await harness.runSync(buildWindow(NEXT_DAY));
    const slidFurtherRun = await harness.runSync(buildWindow(DAY_AFTER));

    expect(rangesWhileInsideWindow).toHaveLength(1);
    expect(slidRun).toEqual(RETIRED);
    expect(slidAgainRun).toEqual(SETTLED);
    expect(slidFurtherRun).toEqual(SETTLED);
    expect(harness.remoteCount()).toBe(0);
    expect(harness.writes()).toBe(1);
    expect(harness.deletes()).toBe(1);
  });

  it("keeps a degenerate range mirrored while the window still contains it", async () => {
    const harness = createHarness([buildEvent({
      endTime: new Date("2027-03-20T16:00:00.000Z"),
      startTime: new Date("2027-03-20T16:00:00.000Z"),
    })]);

    const runs: RunCounts[] = [];
    for (const timeMin of [EDGE_DAY, NEXT_DAY, DAY_AFTER]) {
      runs.push(await harness.runSync(buildWindow(timeMin)));
    }

    expect(runs).toEqual([MIRRORED, SETTLED, SETTLED]);
    expect(harness.writes()).toBe(1);
    expect(harness.deletes()).toBe(0);
    expect(harness.remoteCount()).toBe(1);
  });
});
