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
  startTimeZone: "UTC",
  summary: "Point in time",
  ...overrides,
} as MaterializedSyncableEvent);

interface HarnessOptions {
  events: MaterializedSyncableEvent[];
  scope?: typeof WIDE_SCOPE;
}

interface CalDAVHarness {
  deletes: number;
  mappings: EventMapping[];
  nonConformantResources: string[];
  resources: Map<string, string>;
  writes: number;
  runSync: () => Promise<{
    added: number;
    addFailed: number;
    removed: number;
    removeFailed: number;
  }>;
}

const getIcsLine = (ics: string, name: string): string => {
  const lines = ics.split(/\r?\n/);
  const begin = lines.indexOf("BEGIN:VEVENT");
  const end = lines.indexOf("END:VEVENT");
  if (begin === -1 || end === -1) {
    return "";
  }
  return lines.slice(begin, end).find((line) => line.startsWith(name)) ?? "";
};

// RFC 5545 §3.6.1 requires DTEND later than DTSTART, judged on resolved instants rather than text.
const isNonConformantResource = (ics: string): boolean => {
  if (!getIcsLine(ics, "DTSTART") || !getIcsLine(ics, "DTEND")) {
    return false;
  }
  const [parsed] = parseICalCalendarsToRemoteEvents([ics], {
    rejectUnsupportedRecurrenceDates: false,
  }).events;
  if (!parsed) {
    return true;
  }
  return parsed.endTime.getTime() <= parsed.startTime.getTime();
};

const createCalDAVHarness = (options: HarnessOptions): CalDAVHarness => {
  const resources = new Map<string, string>();
  const mappings: EventMapping[] = [];
  const nonConformantResources: string[] = [];
  const counters = { deletes: 0, writes: 0 };

  const provider: CalendarSyncProvider = {
    deleteEvents: (eventIds) => {
      counters.deletes += eventIds.length;
      for (const eventId of eventIds) {
        resources.delete(eventId);
      }
      return Promise.resolve(eventIds.map(() => ({ success: true })));
    },
    listRemoteEvents: (listOptions) => {
      const parsed = parseICalCalendarsToRemoteEvents([...resources.values()], {
        rejectUnsupportedRecurrenceDates: false,
      });
      const items = parsed.events.flatMap((event): RemoteEvent[] => {
        if (event.endTime < listOptions.timeMin) {
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
      });
      return Promise.resolve({ items, rawItemCount: items.length });
    },
    normalizeEvent: normalizeCalDAVEvent,
    pushEvents: (events) => Promise.resolve(events.map((event) => {
      const uid = generateDeterministicEventUid(event.id);
      const iCalString = eventToICalString(event, uid);
      if (isNonConformantResource(iCalString)) {
        nonConformantResources.push(iCalString);
      }
      counters.writes += 1;
      resources.set(uid, iCalString);
      return { deleteId: uid, remoteId: uid, success: true as const };
    })),
  };

  return {
    get deletes() {
      return counters.deletes;
    },
    mappings,
    nonConformantResources,
    resources,
    get writes() {
      return counters.writes;
    },
    runSync: () => syncCalendar({
      calendarId: DESTINATION_CALENDAR_ID,
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
      readState: async () => {
        const listing = await provider.listRemoteEvents({
          timeMin: (options.scope ?? WIDE_SCOPE).requestedWindow.timeMin,
        });
        return {
          existingMappings: [...mappings],
          localEvents: options.events,
          remoteEvents: listing.items,
          remoteRawItemCount: listing.rawItemCount,
        };
      },
      reconciliationScope: options.scope ?? WIDE_SCOPE,
      userId: "user-1",
    }),
  } as CalDAVHarness;
};

const runThreeTimes = async (harness: CalDAVHarness) => {
  const first = await harness.runSync();
  const second = await harness.runSync();
  const third = await harness.runSync();
  return { first, second, third };
};

describe("caldav destination convergence for degenerate ranges", () => {
  const cases: { name: string; event: MaterializedSyncableEvent }[] = [
    {
      event: buildEvent({}),
      name: "timed zero-duration event",
    },
    {
      event: buildEvent({
        endTime: new Date("2027-03-08T15:00:00.000Z"),
        startTime: new Date("2027-03-08T16:00:00.000Z"),
      }),
      name: "timed inverted event",
    },
    {
      event: buildEvent({
        endTime: new Date("2027-03-08T00:00:00.000Z"),
        isAllDay: true,
        startTime: new Date("2027-03-08T00:00:00.000Z"),
      }),
      name: "same-date all-day event",
    },
    {
      event: buildEvent({
        endTime: new Date("2027-03-05T00:00:00.000Z"),
        isAllDay: true,
        startTime: new Date("2027-03-10T00:00:00.000Z"),
      }),
      name: "inverted multi-day all-day event",
    },
    {
      event: buildEvent({
        endTime: new Date("2027-03-08T23:59:30.000Z"),
        startTime: new Date("2027-03-08T23:59:30.000Z"),
      }),
      name: "zero-duration event whose widened end crosses midnight",
    },
  ];

  for (const testCase of cases) {
    it(`mirrors a ${testCase.name} and converges across repeated runs`, async () => {
      const harness = createCalDAVHarness({ events: [testCase.event] });

      const { first, second, third } = await runThreeTimes(harness);

      expect(harness.nonConformantResources).toEqual([]);
      expect(first).toMatchObject({ added: 1, addFailed: 0, removeFailed: 0 });
      expect(second).toMatchObject({ added: 0, addFailed: 0, removed: 0, removeFailed: 0 });
      expect(third).toMatchObject({ added: 0, addFailed: 0, removed: 0, removeFailed: 0 });
      expect(harness.resources.size).toBe(1);
      expect(harness.mappings).toHaveLength(1);
      expect(harness.deletes).toBe(0);
      expect(harness.writes).toBe(1);
    });
  }
});

describe("caldav convergence near a dst transition", () => {
  const cases: { name: string; event: MaterializedSyncableEvent }[] = [
    {
      event: buildEvent({
        endTime: new Date("2027-03-14T07:29:30.000Z"),
        startTime: new Date("2027-03-14T06:59:30.000Z"),
        startTimeZone: "America/New_York",
      }),
      name: "thirty-minute event straddling a spring-forward transition",
    },
    {
      event: buildEvent({
        endTime: new Date("2027-10-31T01:29:30.000Z"),
        startTime: new Date("2027-10-31T00:59:30.000Z"),
        startTimeZone: "Europe/Berlin",
      }),
      name: "thirty-minute event inside a fall-back repeated hour",
    },
    {
      event: buildEvent({
        endTime: new Date("2026-11-01T06:00:00.000Z"),
        startTime: new Date("2026-11-01T05:30:00.000Z"),
        startTimeZone: "America/New_York",
      }),
      name: "thirty-minute event on the first pass of a fall-back repeated hour",
    },
    {
      event: buildEvent({
        endTime: new Date("2026-11-01T07:00:00.000Z"),
        startTime: new Date("2026-11-01T06:30:00.000Z"),
        startTimeZone: "America/New_York",
      }),
      name: "thirty-minute event on the second pass of a fall-back repeated hour",
    },
    {
      event: buildEvent({
        endTime: new Date("2027-03-14T06:59:30.000Z"),
        startTime: new Date("2027-03-14T06:59:30.000Z"),
        startTimeZone: "America/New_York",
      }),
      name: "zero-duration event straddling a spring-forward transition",
    },
    {
      event: buildEvent({
        endTime: new Date("2027-10-31T00:59:30.000Z"),
        startTime: new Date("2027-10-31T00:59:30.000Z"),
        startTimeZone: "Europe/Berlin",
      }),
      name: "zero-duration event inside a fall-back repeated hour",
    },
  ];

  for (const testCase of cases) {
    it(`mirrors a ${testCase.name} and converges across repeated runs`, async () => {
      const harness = createCalDAVHarness({ events: [testCase.event] });

      const { first, second, third } = await runThreeTimes(harness);

      expect(first).toMatchObject({ added: 1, addFailed: 0 });
      expect(second).toMatchObject({ added: 0, removed: 0 });
      expect(third).toMatchObject({ added: 0, removed: 0 });
      expect(harness.deletes).toBe(0);
      expect(harness.writes).toBe(1);
    });
  }
});

describe("caldav degenerate ranges at the reconciliation window edge", () => {
  const windowStart = new Date("2027-03-08T00:00:00.000Z");
  const edgeScope = {
    authoritativeWindow: {
      timeMax: new Date("2027-06-01T00:00:00.000Z"),
      timeMin: windowStart,
    },
    requestedWindow: {
      timeMax: new Date("2027-06-01T00:00:00.000Z"),
      timeMin: windowStart,
    },
  };

  it("mirrors a zero-duration timed event that starts exactly at the window lower edge", async () => {
    const harness = createCalDAVHarness({
      events: [buildEvent({ endTime: windowStart, startTime: windowStart })],
      scope: edgeScope,
    });

    const { first, second, third } = await runThreeTimes(harness);

    expect(first.added).toBe(1);
    expect(second).toMatchObject({ added: 0, removed: 0 });
    expect(third).toMatchObject({ added: 0, removed: 0 });
    expect(harness.resources.size).toBe(1);
    expect(harness.deletes).toBe(0);
  });

  it("mirrors a same-date all-day event on the window's first day", async () => {
    const harness = createCalDAVHarness({
      events: [buildEvent({
        endTime: windowStart,
        isAllDay: true,
        startTime: windowStart,
      })],
      scope: edgeScope,
    });

    const { first, second, third } = await runThreeTimes(harness);

    expect(first.added).toBe(1);
    expect(second).toMatchObject({ added: 0, removed: 0 });
    expect(third).toMatchObject({ added: 0, removed: 0 });
    expect(harness.resources.size).toBe(1);
    expect(harness.deletes).toBe(0);
  });
});

describe("caldav degenerate range retirement", () => {
  it("retires a mirrored zero-duration event once the source drops it and does not resurrect it", async () => {
    const event = buildEvent({});
    const harness = createCalDAVHarness({ events: [event] });

    await harness.runSync();
    expect(harness.resources.size).toBe(1);

    const emptied = createCalDAVHarness({ events: [] });
    emptied.mappings.push(...harness.mappings);
    for (const [uid, ics] of harness.resources) {
      emptied.resources.set(uid, ics);
    }

    const removal = await emptied.runSync();
    const afterRemoval = await emptied.runSync();

    expect(removal.removed).toBe(1);
    expect(emptied.resources.size).toBe(0);
    expect(emptied.mappings).toHaveLength(0);
    expect(afterRemoval).toMatchObject({ added: 0, removed: 0 });
  });
});
