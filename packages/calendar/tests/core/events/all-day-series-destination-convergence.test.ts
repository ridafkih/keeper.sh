import { KEEPER_CATEGORY } from "@keeper.sh/constants";
import type { GoogleEvent, OutlookEvent } from "@keeper.sh/data-schemas";
import { describe, expect, it } from "vitest";
import { syncCalendar } from "../../../src/core/sync-engine/index";
import type {
  CalendarSyncProvider,
  PendingChanges,
} from "../../../src/core/sync-engine/types";
import type {
  EventMapping,
  MaterializedSyncableEvent,
  RemoteEvent,
  RemoteEventListing,
  SyncableEvent,
} from "../../../src/index";
import { createEditableEventContentHash } from "../../../src/core/events/content-hash";
import { generateDeterministicEventUid } from "../../../src/core/events/identity";
import { materializeRecurrenceEvents } from "../../../src/core/events/recurrence-materializer";
import { normalizeCalDAVEvent } from "../../../src/providers/caldav/destination/normalize-event";
import { normalizeGoogleEvent } from "../../../src/providers/google/destination/normalize-event";
import { normalizeOutlookEvent } from "../../../src/providers/outlook/destination/normalize-event";
import {
  eventToICalString,
  parseICalToRemoteEvent,
} from "../../../src/providers/caldav/shared/ics";
import { serializeGoogleEvent } from "../../../src/providers/google/destination/serialize-event";
import { serializeOutlookEvent } from "../../../src/providers/outlook/destination/serialize-event";
import { parseEventTime as parseGoogleEventTime } from "../../../src/providers/google/shared/date-time";
import { parseEventTime as parseOutlookEventTime } from "../../../src/providers/outlook/shared/date-time";

const DESTINATION_CALENDAR_ID = "destination-calendar";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const WIDE_SCOPE = {
  authoritativeWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
  requestedWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
};

interface RunOutcome {
  added: number;
  addFailed: number;
  removed: number;
  removeFailed: number;
}

interface Harness {
  deletes: string[];
  mappings: EventMapping[];
  remoteSpans: () => string[];
  runSync: () => Promise<RunOutcome>;
  writes: () => number;
}

type LocalEvents = () => MaterializedSyncableEvent[];

const createMappingFlush = (mappings: EventMapping[]) => (changes: PendingChanges): Promise<void> => {
  for (const deleted of changes.deletes) {
    const index = mappings.findIndex((mapping) => mapping.id === deleted);
    if (index !== -1) {
      mappings.splice(index, 1);
    }
  }
  for (const insert of changes.inserts) {
    mappings.push({
      calendarId: insert.calendarId,
      deleteIdentifier: insert.deleteIdentifier,
      destinationEventUid: insert.destinationEventUid,
      endTime: insert.endTime,
      eventStateId: insert.eventStateId,
      id: `mapping-${mappings.length}-${insert.syncEventId}`,
      sourceCalendarId: insert.sourceCalendarId,
      startTime: insert.startTime,
      syncEventHash: insert.syncEventHash,
      syncEventId: insert.syncEventId,
    } as EventMapping);
  }
  return Promise.resolve();
};

const runOnce = async (
  provider: CalendarSyncProvider,
  mappings: EventMapping[],
  events: LocalEvents,
): Promise<RunOutcome> => {
  const result = await syncCalendar({
    calendarId: DESTINATION_CALENDAR_ID,
    flush: createMappingFlush(mappings),
    isCurrent: () => Promise.resolve(true),
    provider,
    readState: async () => {
      const listing = await provider.listRemoteEvents({
        timeMin: WIDE_SCOPE.requestedWindow.timeMin,
        timeMax: WIDE_SCOPE.requestedWindow.timeMax,
      } as Parameters<CalendarSyncProvider["listRemoteEvents"]>[0]);
      return {
        existingMappings: [...mappings],
        localEvents: events(),
        remoteEvents: listing.items,
        remoteRawItemCount: listing.rawItemCount,
      };
    },
    reconciliationScope: WIDE_SCOPE,
    userId: "user-1",
  });
  return {
    added: result.added,
    addFailed: result.addFailed,
    removed: result.removed,
    removeFailed: result.removeFailed,
  };
};

const toGoogleAvailability = (transparency: GoogleEvent["transparency"]) => {
  if (transparency === "transparent") {
    return "free";
  }
  return "busy";
};

const createGoogleHarness = (events: LocalEvents): Harness => {
  const mappings: EventMapping[] = [];
  const resources = new Map<string, GoogleEvent>();
  const deletes: string[] = [];
  let nextRemoteId = 1;
  let writes = 0;

  const toRemoteEvent = (id: string, stored: GoogleEvent): RemoteEvent | null => {
    const startTime = parseGoogleEventTime(stored.start);
    const endTime = parseGoogleEventTime(stored.end);
    if (!startTime || !endTime) {
      return null;
    }
    return {
      deleteId: id,
      editableAvailability: toGoogleAvailability(stored.transparency),
      editableContentHash: createEditableEventContentHash({
        availability: toGoogleAvailability(stored.transparency),
        description: stored.description,
        endTime,
        isAllDay: Boolean(stored.start?.date),
        location: stored.location,
        startTime,
        summary: stored.summary ?? "",
      }),
      endTime,
      isKeeperEvent: true,
      startTime,
      supportedAvailabilities: ["busy", "free"],
      uid: stored.iCalUID ?? id,
    } as RemoteEvent;
  };

  const listRemoteEvents = (): Promise<RemoteEventListing> => {
    const items = [...resources.entries()].flatMap(([id, stored]) => {
      const remoteEvent = toRemoteEvent(id, stored);
      if (!remoteEvent) {
        return [];
      }
      return [remoteEvent];
    });
    return Promise.resolve({ items, rawItemCount: items.length });
  };

  const provider = {
    deleteEvents: (eventIds: string[]) => {
      for (const id of eventIds) {
        deletes.push(id);
        resources.delete(id);
      }
      return Promise.resolve(eventIds.map(() => ({ success: true })));
    },
    listRemoteEvents,
    normalizeEvent: normalizeGoogleEvent,
    pushEvents: (pushed: MaterializedSyncableEvent[]) => Promise.resolve(pushed.map((event) => {
      const uid = generateDeterministicEventUid(event.id);
      const serialized = serializeGoogleEvent(event, uid);
      if (!serialized) {
        return { error: "Event cannot be serialized for Google", success: false as const };
      }
      const start = parseGoogleEventTime(serialized.start);
      const end = parseGoogleEventTime(serialized.end);
      if (!start || !end || end.getTime() <= start.getTime()) {
        return { error: "The specified time range is empty.", success: false as const };
      }
      const googleEventId = `google-${nextRemoteId++}`;
      resources.set(googleEventId, serialized);
      writes += 1;
      return { deleteId: googleEventId, remoteId: uid, success: true as const };
    })),
  } as unknown as CalendarSyncProvider;

  return {
    deletes,
    mappings,
    remoteSpans: () => [...resources.entries()].flatMap(([id, stored]) => {
      const remoteEvent = toRemoteEvent(id, stored);
      if (!remoteEvent) {
        return [];
      }
      return [`${remoteEvent.startTime.toISOString()}/${remoteEvent.endTime.toISOString()}`];
    }),
    runSync: () => runOnce(provider, mappings, events),
    writes: () => writes,
  };
};

const createOutlookHarness = (events: LocalEvents): Harness => {
  const mappings: EventMapping[] = [];
  const resources = new Map<string, OutlookEvent>();
  const deletes: string[] = [];
  let nextRemoteId = 1;
  let writes = 0;

  const toRemoteEvent = (id: string, stored: OutlookEvent): RemoteEvent | null => {
    const startTime = parseOutlookEventTime(stored.start, stored.isAllDay);
    const endTime = parseOutlookEventTime(stored.end, stored.isAllDay);
    if (!startTime || !endTime) {
      return null;
    }
    return {
      deleteId: id,
      editableAvailability: "busy",
      editableContentHash: createEditableEventContentHash({
        availability: "busy",
        description: stored.body?.content,
        endTime,
        isAllDay: stored.isAllDay,
        location: stored.location?.displayName,
        startTime,
        summary: stored.subject ?? "",
      }),
      endTime,
      isKeeperEvent: stored.categories?.includes(KEEPER_CATEGORY) ?? false,
      startTime,
      supportedAvailabilities: ["busy", "free", "oof", "workingElsewhere"],
      uid: `ical-${id}`,
    } as RemoteEvent;
  };

  const listRemoteEvents = (): Promise<RemoteEventListing> => {
    const items = [...resources.entries()].flatMap(([id, stored]) => {
      const remoteEvent = toRemoteEvent(id, stored);
      if (!remoteEvent) {
        return [];
      }
      return [remoteEvent];
    });
    return Promise.resolve({ items, rawItemCount: items.length });
  };

  const provider = {
    deleteEvents: (eventIds: string[]) => {
      for (const id of eventIds) {
        deletes.push(id);
        resources.delete(id);
      }
      return Promise.resolve(eventIds.map(() => ({ success: true })));
    },
    listRemoteEvents,
    normalizeEvent: normalizeOutlookEvent,
    pushEvents: (pushed: MaterializedSyncableEvent[]) => Promise.resolve(pushed.map((event) => {
      const outlookEventId = `outlook-${nextRemoteId++}`;
      resources.set(outlookEventId, serializeOutlookEvent(event));
      writes += 1;
      return {
        deleteId: outlookEventId,
        remoteId: `ical-${outlookEventId}`,
        success: true as const,
      };
    })),
  } as unknown as CalendarSyncProvider;

  return {
    deletes,
    mappings,
    remoteSpans: () => [...resources.entries()].flatMap(([id, stored]) => {
      const remoteEvent = toRemoteEvent(id, stored);
      if (!remoteEvent) {
        return [];
      }
      return [`${remoteEvent.startTime.toISOString()}/${remoteEvent.endTime.toISOString()}`];
    }),
    runSync: () => runOnce(provider, mappings, events),
    writes: () => writes,
  };
};

const createCalDAVHarness = (events: LocalEvents): Harness => {
  const mappings: EventMapping[] = [];
  const resources = new Map<string, string>();
  const deletes: string[] = [];
  let writes = 0;

  const listRemoteEvents = (): Promise<RemoteEventListing> => {
    const items = [...resources.values()].flatMap((iCalString) => {
      const parsed = parseICalToRemoteEvent(iCalString);
      if (!parsed) {
        return [];
      }
      const availability = parsed.availability ?? "busy";
      return [{
        deleteId: parsed.deleteId,
        editableAvailability: availability,
        editableContentHash: createEditableEventContentHash({
          availability,
          description: parsed.description,
          endTime: parsed.endTime,
          isAllDay: parsed.isAllDay,
          location: parsed.location,
          startTime: parsed.startTime,
          summary: parsed.title ?? "",
        }),
        endTime: parsed.endTime,
        isAllDay: parsed.isAllDay,
        isKeeperEvent: parsed.isKeeperEvent,
        startTime: parsed.startTime,
        supportedAvailabilities: ["busy", "free"],
        uid: parsed.uid,
      } as RemoteEvent];
    });
    return Promise.resolve({ items, rawItemCount: items.length });
  };

  const provider = {
    deleteEvents: (eventIds: string[]) => {
      for (const uid of eventIds) {
        deletes.push(uid);
        resources.delete(uid);
      }
      return Promise.resolve(eventIds.map(() => ({ success: true })));
    },
    listRemoteEvents,
    normalizeEvent: normalizeCalDAVEvent,
    pushEvents: (pushed: MaterializedSyncableEvent[]) => Promise.resolve(pushed.map((event) => {
      const uid = generateDeterministicEventUid(event.id);
      resources.set(uid, eventToICalString(event, uid));
      writes += 1;
      return { deleteId: uid, remoteId: uid, success: true as const };
    })),
  } as unknown as CalendarSyncProvider;

  return {
    deletes,
    mappings,
    remoteSpans: () => [...resources.values()].flatMap((iCalString) => {
      const parsed = parseICalToRemoteEvent(iCalString);
      if (!parsed) {
        return [];
      }
      return [`${parsed.startTime.toISOString()}/${parsed.endTime.toISOString()}`];
    }),
    runSync: () => runOnce(provider, mappings, events),
    writes: () => writes,
  };
};

const HARNESSES: { create: (events: LocalEvents) => Harness; name: string }[] = [
  { create: createGoogleHarness, name: "google" },
  { create: createOutlookHarness, name: "outlook" },
  { create: createCalDAVHarness, name: "caldav" },
];

const buildAllDayMaster = (overrides: Partial<SyncableEvent> = {}): SyncableEvent => ({
  availability: "busy",
  calendarId: "source-calendar",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2027-03-13T00:00:00.000Z"),
  eventStateId: "event-state-1",
  id: "event-state-1",
  isAllDay: true,
  recurrenceRule: { count: 8, frequency: "DAILY" },
  sourceEventUid: "source-uid-1",
  startTime: new Date("2027-03-12T00:00:00.000Z"),
  startTimeZone: "America/New_York",
  summary: "Daily all-day standup",
  ...overrides,
} as SyncableEvent);

const SERIES_WINDOW = {
  end: new Date("2027-03-25T00:00:00.000Z"),
  start: new Date("2027-03-01T00:00:00.000Z"),
};

const materialize = (
  events: SyncableEvent[],
  window = SERIES_WINDOW,
): MaterializedSyncableEvent[] => materializeRecurrenceEvents(events, window);

const spanDayLengths = (spans: string[]): number[] =>
  spans.map((span) => {
    const [start, end] = span.split("/");
    return (new Date(String(end)).getTime() - new Date(String(start)).getTime()) / MS_PER_DAY;
  });

const IDLE = { added: 0, addFailed: 0, removed: 0, removeFailed: 0 };

describe("mirroring an all-day series across a daylight transition", () => {
  for (const harnessCase of HARNESSES) {
    it(`writes each occurrence once and settles on ${harnessCase.name}`, async () => {
      const master = buildAllDayMaster();
      const harness = harnessCase.create(() => materialize([master]));

      const first = await harness.runSync();
      const second = await harness.runSync();
      const third = await harness.runSync();

      expect(first).toEqual({ added: 8, addFailed: 0, removed: 0, removeFailed: 0 });
      expect(second).toEqual(IDLE);
      expect(third).toEqual(IDLE);
      expect(harness.writes()).toBe(8);
      expect(harness.deletes).toEqual([]);
      expect(harness.mappings).toHaveLength(8);
    });

    it(`mirrors eight distinct whole days on ${harnessCase.name}`, async () => {
      const master = buildAllDayMaster();
      const harness = harnessCase.create(() => materialize([master]));

      await harness.runSync();
      await harness.runSync();

      const spans = harness.remoteSpans().toSorted();
      expect(spanDayLengths(spans)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
      expect(spans.map((span) => span.split("/")[0])).toEqual([
        "2027-03-12T00:00:00.000Z",
        "2027-03-13T00:00:00.000Z",
        "2027-03-14T00:00:00.000Z",
        "2027-03-15T00:00:00.000Z",
        "2027-03-16T00:00:00.000Z",
        "2027-03-17T00:00:00.000Z",
        "2027-03-18T00:00:00.000Z",
        "2027-03-19T00:00:00.000Z",
      ]);
    });

    it(`does not rewrite the mirror when the read window moves on ${harnessCase.name}`, async () => {
      const master = buildAllDayMaster();
      let window = SERIES_WINDOW;
      const harness = harnessCase.create(() => materialize([master], window));

      const first = await harness.runSync();
      window = {
        end: new Date(SERIES_WINDOW.end.getTime() + 90 * 60 * 1000),
        start: new Date(SERIES_WINDOW.start.getTime() + 90 * 60 * 1000),
      };
      const second = await harness.runSync();
      window = {
        end: new Date(SERIES_WINDOW.end.getTime() + 7 * 60 * 60 * 1000),
        start: new Date(SERIES_WINDOW.start.getTime() + 7 * 60 * 60 * 1000),
      };
      const third = await harness.runSync();

      expect(first.added).toBe(8);
      expect(second).toEqual(IDLE);
      expect(third).toEqual(IDLE);
      expect(harness.deletes).toEqual([]);
    });

    it(`keeps a cancelled day cancelled on ${harnessCase.name}`, async () => {
      const master = buildAllDayMaster({
        exceptionDates: [new Date("2027-03-15T00:00:00.000Z")],
      });
      const harness = harnessCase.create(() => materialize([master]));

      const first = await harness.runSync();
      const second = await harness.runSync();

      expect(first.added).toBe(7);
      expect(second).toEqual(IDLE);
      expect(harness.remoteSpans().toSorted().map((span) => span.split("/")[0])).toEqual([
        "2027-03-12T00:00:00.000Z",
        "2027-03-13T00:00:00.000Z",
        "2027-03-14T00:00:00.000Z",
        "2027-03-16T00:00:00.000Z",
        "2027-03-17T00:00:00.000Z",
        "2027-03-18T00:00:00.000Z",
        "2027-03-19T00:00:00.000Z",
      ]);
    });

    it(`mirrors a moved day once and only once on ${harnessCase.name}`, async () => {
      const master = buildAllDayMaster();
      const { recurrenceRule: _recurrenceRule, ...masterFields } = buildAllDayMaster();
      const override = {
        ...masterFields,
        endTime: new Date("2027-03-23T00:00:00.000Z"),
        eventStateId: "event-state-2",
        id: "event-state-2",
        recurrenceId: new Date("2027-03-16T00:00:00.000Z"),
        startTime: new Date("2027-03-22T00:00:00.000Z"),
      } as SyncableEvent;
      const harness = harnessCase.create(() => materialize([master, override]));

      const first = await harness.runSync();
      const second = await harness.runSync();

      expect(first.added).toBe(8);
      expect(second).toEqual(IDLE);
      const starts = harness.remoteSpans().toSorted().map((span) => span.split("/")[0]);
      expect(starts).toContain("2027-03-22T00:00:00.000Z");
      expect(starts).not.toContain("2027-03-16T00:00:00.000Z");
      expect(new Set(starts).size).toBe(8);
    });
  }
});

describe("mirroring an all-day series a source states off the UTC day grid", () => {
  for (const harnessCase of HARNESSES) {
    it(`settles on the days it touches on ${harnessCase.name}`, async () => {
      const master = buildAllDayMaster({
        endTime: new Date("2027-03-12T17:00:00.000Z"),
        startTime: new Date("2027-03-12T09:00:00.000Z"),
      });
      const harness = harnessCase.create(() => materialize([master]));

      const first = await harness.runSync();
      const second = await harness.runSync();
      const third = await harness.runSync();

      expect(first.added).toBe(8);
      expect(second).toEqual(IDLE);
      expect(third).toEqual(IDLE);
      expect(harness.deletes).toEqual([]);
      expect(spanDayLengths(harness.remoteSpans())).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    });
  }
});
