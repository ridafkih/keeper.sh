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
import { parseIcsCalendar } from "../../../src/ics/utils/parse-ics-calendar";
import { parseIcsEvents, parseIcsEventsWithDiagnostics } from "../../../src/ics/utils/parse-ics-events";

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
  endTime: new Date("2027-03-09T00:00:00.000Z"),
  eventStateId: "event-state-1",
  id: "event-state-1",
  isAllDay: true,
  sourceEventUid: "source-uid",
  startTime: new Date("2027-03-08T00:00:00.000Z"),
  summary: "Whole day",
  ...overrides,
} as MaterializedSyncableEvent);

interface RunResult {
  added: number;
  addFailed: number;
  removed: number;
  removeFailed: number;
}

const toRunCounts = (result: RunResult): RunResult => ({
  addFailed: result.addFailed,
  added: result.added,
  removeFailed: result.removeFailed,
  removed: result.removed,
});

const SETTLED: RunResult = { addFailed: 0, added: 0, removeFailed: 0, removed: 0 };

interface Harness {
  deletes: () => number;
  mappings: EventMapping[];
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

const createGoogleHarness: HarnessFactory = (events, scope) => {
  const mappings: EventMapping[] = [];
  const stored = new Map<string, GoogleEvent & { id: string }>();
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
      counters.writes += 1;
      stored.set(uid, { ...payload, id: uid });
      return { deleteId: uid, remoteId: uid, success: true as const };
    })),
  };

  return {
    deletes: () => counters.deletes,
    mappings,
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
      counters.writes += 1;
      stored.set(uid, { ...payload, id: uid });
      return { deleteId: uid, remoteId: uid, success: true as const };
    })),
  };

  return {
    deletes: () => counters.deletes,
    mappings,
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
    listRemoteEvents: () => listRemoteEvents(),
    normalizeEvent: normalizeCalDAVEvent,
    pushEvents: (pushed) => Promise.resolve(pushed.map((event) => {
      const uid = generateDeterministicEventUid(event.id);
      counters.writes += 1;
      resources.set(uid, eventToICalString(event, uid));
      return { deleteId: uid, remoteId: uid, success: true as const };
    })),
  };

  return {
    deletes: () => counters.deletes,
    mappings,
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

const MISALIGNED_SHAPES: { event: MaterializedSyncableEvent; name: string }[] = [
  {
    event: buildEvent({
      endTime: new Date("2027-03-09T12:00:00.000Z"),
      startTime: new Date("2027-03-08T00:00:00.000Z"),
    }),
    name: "all-day range of one and a half days",
  },
  {
    event: buildEvent({
      endTime: new Date("2027-03-13T05:00:00.000Z"),
      startTime: new Date("2027-03-12T00:00:00.000Z"),
    }),
    name: "all-day range whose end is the next local midnight of a western zone",
  },
  {
    event: buildEvent({
      endTime: new Date("2027-03-09T05:00:00.000Z"),
      startTime: new Date("2027-03-08T05:00:00.000Z"),
    }),
    name: "all-day range of exactly one day that does not start at UTC midnight",
  },
];

const ALIGNED_SHAPES: { event: MaterializedSyncableEvent; name: string }[] = [
  {
    event: buildEvent({
      endTime: new Date("2027-03-09T00:00:00.000Z"),
      startTime: new Date("2027-03-08T00:00:00.000Z"),
    }),
    name: "all-day range of exactly one whole day",
  },
  {
    event: buildEvent({
      endTime: new Date("2027-03-10T00:00:00.000Z"),
      startTime: new Date("2027-03-08T00:00:00.000Z"),
    }),
    name: "all-day range of two whole days",
  },
  {
    event: buildEvent({
      endTime: new Date("2027-03-08T23:00:00.000Z"),
      startTime: new Date("2027-03-08T00:00:00.000Z"),
    }),
    name: "all-day range shorter than a day, which the normalizer widens",
  },
  {
    event: buildEvent({
      endTime: new Date("2027-03-08T00:00:00.000Z"),
      startTime: new Date("2027-03-08T00:00:00.000Z"),
    }),
    name: "same-date all-day range",
  },
];

const runThree = async (harness: Harness): Promise<RunResult[]> => [
  toRunCounts(await harness.runSync()),
  toRunCounts(await harness.runSync()),
  toRunCounts(await harness.runSync()),
];

describe("all-day ranges that are whole UTC days", () => {
  for (const destination of DESTINATIONS) {
    for (const shape of ALIGNED_SHAPES) {
      it(`${destination.name} settles on an ${shape.name}`, async () => {
        const harness = destination.factory([shape.event], WIDE_SCOPE);
        const [first, second, third] = await runThree(harness);

        expect(first).toEqual({ ...SETTLED, added: 1 });
        expect(second).toEqual(SETTLED);
        expect(third).toEqual(SETTLED);
        expect(harness.writes()).toBe(1);
        expect(harness.deletes()).toBe(0);
        expect(harness.mappings).toHaveLength(1);
      });
    }
  }
});

describe("all-day ranges that are not whole UTC days", () => {
  for (const destination of DESTINATIONS) {
    for (const shape of MISALIGNED_SHAPES) {
      it(`${destination.name} settles on an ${shape.name}`, async () => {
        const harness = destination.factory([shape.event], WIDE_SCOPE);
        const [first, second, third] = await runThree(harness);

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

describe("repeated runs over an all-day range that is not a whole UTC day", () => {
  for (const destination of DESTINATIONS) {
    it(`${destination.name} stops rewriting the mirror after the first run`, async () => {
      const event = buildEvent({
        endTime: new Date("2027-03-13T05:00:00.000Z"),
        startTime: new Date("2027-03-12T00:00:00.000Z"),
      });
      const harness = destination.factory([event], WIDE_SCOPE);
      const runs: RunResult[] = [];
      for (let run = 0; run < 5; run += 1) {
        runs.push(toRunCounts(await harness.runSync()));
      }

      expect(runs.map(({ added }) => added)).toEqual([1, 0, 0, 0, 0]);
      expect(runs.map(({ removed }) => removed)).toEqual([0, 0, 0, 0, 0]);
      expect(harness.writes()).toBe(1);
      expect(harness.deletes()).toBe(0);
    });
  }
});

describe("an ICS source stating an all-day event with a date-time end", () => {
  const parseFeed = (lines: string[]) => parseIcsCalendar({
    icsString: [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//keeper//probe//EN",
      ...lines,
      "END:VCALENDAR",
    ].join("\r\n"),
  });

  const readFeed = (lines: string[]) => parseIcsEvents(parseFeed(lines));

  const readFeedWithDiagnostics = (lines: string[]) =>
    parseIcsEventsWithDiagnostics(parseFeed(lines));

  it("stores a whole number of days for a date-valued end", () => {
    const [event] = readFeed([
      "BEGIN:VEVENT",
      "UID:aligned",
      "DTSTAMP:20270301T000000Z",
      "DTSTART;VALUE=DATE:20270308",
      "DTEND;VALUE=DATE:20270309",
      "SUMMARY:Aligned",
      "END:VEVENT",
    ]);

    expect(event?.isAllDay).toBe(true);
    expect(event?.endTime.getTime()).toBe(new Date("2027-03-09T00:00:00.000Z").getTime());
  });

  it("rejects a sub-day DURATION on an all-day event", () => {
    const parsed = readFeedWithDiagnostics([
      "BEGIN:VEVENT",
      "UID:aligned",
      "DTSTAMP:20270301T000000Z",
      "DTSTART;VALUE=DATE:20270308",
      "DTEND;VALUE=DATE:20270309",
      "SUMMARY:Aligned",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:sub-day-duration",
      "DTSTAMP:20270301T000000Z",
      "DTSTART;VALUE=DATE:20270308",
      "DURATION:PT36H",
      "SUMMARY:Sub-day duration",
      "END:VEVENT",
    ]);

    expect(parsed.events.map((event) => event.uid)).toEqual(["aligned"]);
    expect(parsed.unrepresentableCount).toBe(1);
  });

  it("stores an all-day range that no destination can hold when the end is a date-time", () => {
    const [event] = readFeed([
      "BEGIN:VEVENT",
      "UID:misaligned",
      "DTSTAMP:20270301T000000Z",
      "DTSTART;VALUE=DATE:20270312",
      "DTEND;TZID=America/New_York:20270313T000000",
      "SUMMARY:Misaligned",
      "END:VEVENT",
    ]);

    expect(event?.isAllDay).toBe(true);
    expect(event?.endTime.toISOString()).toBe("2027-03-13T05:00:00.000Z");
    const spanMs = (event?.endTime.getTime() ?? 0) - (event?.startTime.getTime() ?? 0);
    expect(spanMs % 86_400_000).not.toBe(0);
  });
});
