import { describe, expect, it } from "vitest";
import type { GoogleEvent, OutlookEvent } from "@keeper.sh/data-schemas";
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

interface Window {
  timeMax: Date;
  timeMin: Date;
}

interface Scope {
  authoritativeWindow: Window;
  requestedWindow: Window;
}

const WIDE_SCOPE: Scope = {
  authoritativeWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
  requestedWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
};

const toAvailability = (isFree: boolean): "busy" | "free" => {
  if (isFree) {
    return "free";
  }
  return "busy";
};

const buildEvent = (
  overrides: Partial<MaterializedSyncableEvent>,
): MaterializedSyncableEvent => ({
  availability: "busy",
  calendarId: "source-calendar",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2027-03-08T16:00:00.000Z"),
  eventStateId: "event-state-1",
  id: "event-state-1",
  sourceEventUid: "source-uid",
  startTime: new Date("2027-03-08T16:00:00.000Z"),
  summary: "Point in time",
  ...overrides,
} as MaterializedSyncableEvent);

interface RunResult {
  added: number;
  addFailed: number;
  removed: number;
  removeFailed: number;
}

const toRunCounts = (result: {
  added: number;
  addFailed: number;
  removed: number;
  removeFailed: number;
}): RunResult => ({
  addFailed: result.addFailed,
  added: result.added,
  removeFailed: result.removeFailed,
  removed: result.removed,
});

const SETTLED: RunResult = { addFailed: 0, added: 0, removeFailed: 0, removed: 0 };

interface Harness {
  deletes: () => number;
  mappings: EventMapping[];
  pushRejections: string[];
  remoteRanges: () => { end: string; start: string }[];
  runSync: () => Promise<RunResult>;
  writes: () => number;
}

type HarnessFactory = (events: MaterializedSyncableEvent[], scope: Scope) => Harness;

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

const googleRejectsRange = (payload: GoogleEvent): boolean => {
  if (payload.start?.date && payload.end?.date) {
    return payload.end.date <= payload.start.date;
  }
  if (payload.start?.dateTime && payload.end?.dateTime) {
    return new Date(payload.end.dateTime).getTime() <= new Date(payload.start.dateTime).getTime();
  }
  return false;
};

const outlookRejectsRange = (payload: OutlookEvent): boolean => {
  const startTime = parseOutlookEventTime(payload.start, payload.isAllDay ?? false);
  const endTime = parseOutlookEventTime(payload.end, payload.isAllDay ?? false);
  if (!startTime || !endTime) {
    return true;
  }
  if (payload.isAllDay) {
    return endTime.getTime() <= startTime.getTime();
  }
  return endTime.getTime() < startTime.getTime();
};

const createGoogleHarness: HarnessFactory = (events, scope) => {
  const mappings: EventMapping[] = [];
  const stored = new Map<string, GoogleEvent & { id: string }>();
  const pushRejections: string[] = [];
  const counters = { deletes: 0, writes: 0 };

  const listRemoteEvents = (): Promise<RemoteEvent[]> =>
    Promise.resolve([...stored.values()].flatMap((event): RemoteEvent[] => {
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
    }));

  const provider: CalendarSyncProvider = {
    deleteEvents: (eventIds) => {
      counters.deletes += eventIds.length;
      for (const eventId of eventIds) {
        stored.delete(eventId);
      }
      return Promise.resolve(eventIds.map(() => ({ success: true })));
    },
    listRemoteEvents,
    normalizeEvent: normalizeGoogleEvent,
    pushEvents: (pushed) => Promise.resolve(pushed.map((event) => {
      const uid = generateDeterministicEventUid(event.id);
      const payload = serializeGoogleEvent(event, uid);
      if (!payload) {
        return { success: false as const, error: "not serializable" };
      }
      if (googleRejectsRange(payload)) {
        pushRejections.push("The specified time range is empty.");
        return { success: false as const, error: "The specified time range is empty." };
      }
      counters.writes += 1;
      stored.set(uid, { ...payload, id: uid });
      return { deleteId: uid, remoteId: uid, success: true as const };
    })),
  };

  return {
    deletes: () => counters.deletes,
    mappings,
    pushRejections,
    remoteRanges: () => [...stored.values()].map((event) => ({
      end: parseGoogleEventTime(event.end)?.toISOString() ?? "",
      start: parseGoogleEventTime(event.start)?.toISOString() ?? "",
    })),
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
      reconciliationScope: scope,
      userId: "user-1",
    }),
    writes: () => counters.writes,
  };
};

const createOutlookHarness: HarnessFactory = (events, scope) => {
  const mappings: EventMapping[] = [];
  const stored = new Map<string, OutlookEvent & { id: string }>();
  const pushRejections: string[] = [];
  const counters = { deletes: 0, writes: 0 };

  const listRemoteEvents = (): Promise<RemoteEvent[]> =>
    Promise.resolve([...stored.values()].flatMap((event): RemoteEvent[] => {
      const isAllDay = event.isAllDay ?? false;
      const startTime = parseOutlookEventTime(event.start, isAllDay);
      const endTime = parseOutlookEventTime(event.end, isAllDay);
      if (!startTime || !endTime) {
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
    listRemoteEvents,
    normalizeEvent: normalizeOutlookEvent,
    pushEvents: (pushed) => Promise.resolve(pushed.map((event) => {
      const uid = generateDeterministicEventUid(event.id);
      const payload = { ...serializeOutlookEvent(event), iCalUId: uid };
      if (outlookRejectsRange(payload)) {
        pushRejections.push("The end date must be after the start date.");
        return { success: false as const, error: "The end date must be after the start date." };
      }
      counters.writes += 1;
      stored.set(uid, { ...payload, id: uid });
      return { deleteId: uid, remoteId: uid, success: true as const };
    })),
  };

  return {
    deletes: () => counters.deletes,
    mappings,
    pushRejections,
    remoteRanges: () => [...stored.values()].map((event) => {
      const isAllDay = event.isAllDay ?? false;
      return {
        end: parseOutlookEventTime(event.end, isAllDay)?.toISOString() ?? "",
        start: parseOutlookEventTime(event.start, isAllDay)?.toISOString() ?? "",
      };
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
      reconciliationScope: scope,
      userId: "user-1",
    }),
    writes: () => counters.writes,
  };
};

const parseResource = (ics: string) => parseICalCalendarsToRemoteEvents([ics], {
  rejectUnsupportedRecurrenceDates: false,
}).events[0];

const createCalDAVHarness: HarnessFactory = (events, scope) => {
  const mappings: EventMapping[] = [];
  const resources = new Map<string, string>();
  const pushRejections: string[] = [];
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
        pushRejections.push(iCalString);
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
    pushRejections,
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
        remoteEvents: await listRemoteEvents(scope.requestedWindow.timeMin),
      }),
      reconciliationScope: scope,
      userId: "user-1",
    }),
    writes: () => counters.writes,
  };
};

const DESTINATIONS: { factory: HarnessFactory; name: string }[] = [
  { factory: createCalDAVHarness, name: "caldav" },
  { factory: createGoogleHarness, name: "google" },
  { factory: createOutlookHarness, name: "outlook" },
];

const SHAPES: { event: MaterializedSyncableEvent; name: string }[] = [
  {
    event: buildEvent({
      endTime: new Date("2027-03-08T16:00:00.000Z"),
      startTime: new Date("2027-03-08T16:00:00.000Z"),
    }),
    name: "zero-duration timed range with no zone",
  },
  {
    event: buildEvent({
      endTime: new Date("2027-03-08T15:00:00.000Z"),
      startTime: new Date("2027-03-08T16:00:00.000Z"),
    }),
    name: "inverted timed range with no zone",
  },
  {
    event: buildEvent({
      endTime: new Date("2027-03-08T00:00:00.000Z"),
      isAllDay: true,
      startTime: new Date("2027-03-08T00:00:00.000Z"),
    }),
    name: "same-date all-day range",
  },
  {
    event: buildEvent({
      endTime: new Date("2027-03-05T00:00:00.000Z"),
      isAllDay: true,
      startTime: new Date("2027-03-10T00:00:00.000Z"),
    }),
    name: "inverted all-day range",
  },
  {
    event: buildEvent({
      endTime: new Date("2027-03-08T12:00:00.000Z"),
      isAllDay: true,
      startTime: new Date("2027-03-08T00:00:00.000Z"),
    }),
    name: "all-day range shorter than a day",
  },
  {
    event: buildEvent({
      endTime: new Date("2027-04-04T03:00:00.000Z"),
      startTime: new Date("2027-04-04T03:00:00.000Z"),
      startTimeZone: "Australia/Lord_Howe",
    }),
    name: "zero-duration range on a half-hour daylight shift",
  },
  {
    event: buildEvent({
      endTime: new Date("2027-09-26T13:00:00.000Z"),
      startTime: new Date("2027-09-26T13:00:00.000Z"),
      startTimeZone: "Pacific/Chatham",
    }),
    name: "zero-duration range on a 45-minute offset zone's spring-forward instant",
  },
  {
    event: buildEvent({
      endTime: new Date("2027-06-15T02:29:30.000Z"),
      startTime: new Date("2027-06-15T02:29:30.000Z"),
      startTimeZone: "America/St_Johns",
    }),
    name: "zero-duration range whose widened minute crosses local midnight in a half-hour offset zone",
  },
  {
    event: buildEvent({
      endTime: new Date("2027-09-25T13:00:00.000Z"),
      startTime: new Date("2027-09-26T13:00:00.000Z"),
      startTimeZone: "Pacific/Apia",
    }),
    name: "inverted range in a zone that has skipped a calendar day",
  },
  {
    event: buildEvent({
      availability: "free",
      endTime: new Date("2027-03-08T16:00:00.000Z"),
      startTime: new Date("2027-03-08T16:00:00.000Z"),
      summary: "",
    }),
    name: "zero-duration range with every optional field absent",
  },
];

const runThree = async (harness: Harness): Promise<RunResult[]> => [
  toRunCounts(await harness.runSync()),
  toRunCounts(await harness.runSync()),
  toRunCounts(await harness.runSync()),
];

describe("degenerate range mirroring across every destination", () => {
  for (const destination of DESTINATIONS) {
    for (const shape of SHAPES) {
      it(`${destination.name} mirrors and settles on a ${shape.name}`, async () => {
        const harness = destination.factory([shape.event], WIDE_SCOPE);
        const [first, second, third] = await runThree(harness);

        expect(harness.pushRejections).toEqual([]);
        expect(first).toEqual({ ...SETTLED, added: 1 });
        expect(second).toEqual(SETTLED);
        expect(third).toEqual(SETTLED);
        expect(harness.writes()).toBe(1);
        expect(harness.deletes()).toBe(0);
        expect(harness.mappings).toHaveLength(1);
        expect(harness.remoteRanges()).toHaveLength(1);
      });
    }
  }
});

const EDGE_WINDOW: Window = {
  timeMax: new Date("2027-04-08T00:00:00.000Z"),
  timeMin: new Date("2027-03-08T00:00:00.000Z"),
};

const EDGE_SCOPE: Scope = {
  authoritativeWindow: EDGE_WINDOW,
  requestedWindow: EDGE_WINDOW,
};

const EDGE_PLACEMENTS: { instant: string; name: string }[] = [
  { instant: "2027-03-08T00:00:00.000Z", name: "exactly on the lower edge" },
  { instant: "2027-03-08T00:00:00.001Z", name: "one millisecond inside the lower edge" },
  { instant: "2027-03-07T23:59:59.999Z", name: "one millisecond below the lower edge" },
  { instant: "2027-03-07T23:59:00.000Z", name: "a whole minute below the lower edge" },
  { instant: "2027-04-07T23:59:59.999Z", name: "one millisecond inside the upper edge" },
  { instant: "2027-04-07T23:59:30.000Z", name: "close enough to the upper edge that widening crosses it" },
  { instant: "2027-04-08T00:00:00.000Z", name: "exactly on the upper edge" },
];

describe("degenerate range window edges across every destination", () => {
  for (const destination of DESTINATIONS) {
    for (const placement of EDGE_PLACEMENTS) {
      it(`${destination.name} settles on a zero-duration event ${placement.name}`, async () => {
        const event = buildEvent({
          endTime: new Date(placement.instant),
          startTime: new Date(placement.instant),
        });
        const harness = destination.factory([event], EDGE_SCOPE);
        const [, second, third] = await runThree(harness);

        expect(harness.pushRejections).toEqual([]);
        expect(second).toEqual(SETTLED);
        expect(third).toEqual(SETTLED);
        expect(harness.deletes()).toBe(0);
      });
    }
  }

  for (const destination of DESTINATIONS) {
    it(`${destination.name} retires a zero-duration event exactly once as the window sweeps past it`, async () => {
      const event = buildEvent({
        endTime: new Date("2027-03-09T00:00:00.000Z"),
        startTime: new Date("2027-03-09T00:00:00.000Z"),
      });
      const scope: Scope = {
        authoritativeWindow: { ...EDGE_WINDOW },
        requestedWindow: { ...EDGE_WINDOW },
      };
      const harness = destination.factory([event], scope);
      const removals: number[] = [];
      const additions: number[] = [];

      for (let day = 0; day < 8; day += 1) {
        const timeMin = new Date(EDGE_WINDOW.timeMin.getTime() + day * 24 * 60 * 60 * 1000);
        const timeMax = new Date(EDGE_WINDOW.timeMax.getTime() + day * 24 * 60 * 60 * 1000);
        scope.authoritativeWindow.timeMin = timeMin;
        scope.authoritativeWindow.timeMax = timeMax;
        scope.requestedWindow.timeMin = timeMin;
        scope.requestedWindow.timeMax = timeMax;
        const result = toRunCounts(await harness.runSync());
        additions.push(result.added);
        removals.push(result.removed);
        const repeat = toRunCounts(await harness.runSync());
        expect(repeat).toEqual(SETTLED);
      }

      expect(additions.reduce((total, value) => total + value, 0)).toBe(1);
      expect(removals.reduce((total, value) => total + value, 0)).toBeLessThanOrEqual(1);
      expect(harness.remoteRanges()).toHaveLength(0);
    });
  }
});
