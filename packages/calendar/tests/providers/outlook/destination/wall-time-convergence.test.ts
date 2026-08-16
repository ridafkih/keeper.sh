import { KEEPER_CATEGORY } from "@keeper.sh/constants";
import type { OutlookEvent } from "@keeper.sh/data-schemas";
import { describe, expect, it } from "vitest";
import { syncCalendar } from "../../../../src/core/sync-engine/index";
import type {
  CalendarSyncProvider,
  PendingChanges,
} from "../../../../src/core/sync-engine/types";
import type {
  EventMapping,
  MaterializedSyncableEvent,
  RemoteEvent,
  RemoteEventListing,
} from "../../../../src/index";
import { createEditableEventContentHash } from "../../../../src/core/events/content-hash";
import { normalizeOutlookEvent } from "../../../../src/providers/outlook/destination/normalize-event";
import { serializeOutlookEvent } from "../../../../src/providers/outlook/destination/serialize-event";
import { parseEventTime } from "../../../../src/providers/outlook/shared/date-time";
import { buildZonedIcsDate } from "../../../../src/ics/utils/build-zoned-date";
import { wallTimeToInstant } from "../../../../src/ics/utils/timezone-instant";

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
  endTime: new Date("2027-06-01T17:00:00.000Z"),
  eventStateId: "event-state-1",
  id: "event-state-1",
  sourceEventUid: "source-uid",
  startTime: new Date("2027-06-01T16:00:00.000Z"),
  startTimeZone: "UTC",
  summary: "Mirrored event",
  ...overrides,
} as MaterializedSyncableEvent);

interface RunOutcome {
  added: number;
  addFailed: number;
  removed: number;
  removeFailed: number;
}

interface Harness {
  deletes: string[];
  mappings: EventMapping[];
  remoteRanges: () => string[];
  runSync: () => Promise<RunOutcome>;
  writes: number;
}

const createOutlookHarness = (events: () => MaterializedSyncableEvent[]): Harness => {
  const mappings: EventMapping[] = [];
  const resources = new Map<string, OutlookEvent>();
  const deletes: string[] = [];
  let nextRemoteId = 1;
  let writes = 0;

  const toRemoteEvent = (id: string, stored: OutlookEvent): RemoteEvent | null => {
    const startTime = parseEventTime(stored.start, stored.isAllDay);
    const endTime = parseEventTime(stored.end, stored.isAllDay);
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

  const provider: CalendarSyncProvider = {
    deleteEvents: (eventIds) => {
      for (const id of eventIds) {
        deletes.push(id);
        resources.delete(id);
      }
      return Promise.resolve(eventIds.map(() => ({ success: true })));
    },
    listRemoteEvents,
    normalizeEvent: normalizeOutlookEvent,
    pushEvents: (pushed) => Promise.resolve(pushed.map((event) => {
      const outlookEventId = `outlook-${nextRemoteId++}`;
      resources.set(outlookEventId, serializeOutlookEvent(event));
      writes += 1;
      return { deleteId: outlookEventId, remoteId: `ical-${outlookEventId}`, success: true as const };
    })),
  };

  return {
    deletes,
    mappings,
    remoteRanges: () => [...resources.entries()].flatMap(([id, stored]) => {
      const remoteEvent = toRemoteEvent(id, stored);
      if (!remoteEvent) {
        return [];
      }
      return [`${remoteEvent.startTime.toISOString()}/${remoteEvent.endTime.toISOString()}`];
    }),
    runSync: async () => {
      const result = await syncCalendar({
        calendarId: DESTINATION_CALENDAR_ID,
        flush: (changes: PendingChanges) => {
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
        },
        isCurrent: () => Promise.resolve(true),
        provider,
        readState: async () => {
          const listing = await listRemoteEvents();
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
    },
    get writes() {
      return writes;
    },
  } as Harness;
};

const IDLE = { added: 0, addFailed: 0, removed: 0, removeFailed: 0 };

describe("outlook destination convergence across repeated runs", () => {
  const cases: { event: MaterializedSyncableEvent; name: string; range: string }[] = [
    {
      event: buildEvent({}),
      name: "ordinary timed event in UTC",
      range: "2027-06-01T16:00:00.000Z/2027-06-01T17:00:00.000Z",
    },
    {
      event: buildEvent({
        endTime: new Date("2027-06-01T16:00:00.000Z"),
        startTime: new Date("2027-06-01T16:00:00.000Z"),
      }),
      name: "zero-duration timed event",
      range: "2027-06-01T16:00:00.000Z/2027-06-01T16:00:00.000Z",
    },
    {
      event: buildEvent({
        endTime: new Date("2027-06-01T15:00:00.000Z"),
        startTime: new Date("2027-06-01T16:00:00.000Z"),
      }),
      name: "inverted timed event",
      range: "2027-06-01T16:00:00.000Z/2027-06-01T16:01:00.000Z",
    },
    {
      event: buildEvent({
        endTime: new Date("2027-06-01T17:00:00.000Z"),
        isAllDay: true,
        startTime: new Date("2027-06-01T09:00:00.000Z"),
      }),
      name: "all-day event off the UTC day grid",
      range: "2027-06-01T00:00:00.000Z/2027-06-02T00:00:00.000Z",
    },
    {
      event: buildEvent({
        endTime: new Date("2027-06-01T00:00:00.000Z"),
        isAllDay: true,
        startTime: new Date("2027-06-01T00:00:00.000Z"),
      }),
      name: "same-date all-day event",
      range: "2027-06-01T00:00:00.000Z/2027-06-02T00:00:00.000Z",
    },
    {
      event: buildEvent({
        endTime: new Date("2027-03-14T08:00:00.000Z"),
        startTime: new Date("2027-03-14T06:00:00.000Z"),
        startTimeZone: "America/New_York",
      }),
      name: "zoned event spanning a spring-forward transition",
      range: "2027-03-14T06:00:00.000Z/2027-03-14T08:00:00.000Z",
    },
  ];

  for (const testCase of cases) {
    it(`mirrors a ${testCase.name} once and stops`, async () => {
      const harness = createOutlookHarness(() => [testCase.event]);

      const first = await harness.runSync();
      const second = await harness.runSync();
      const third = await harness.runSync();
      const fourth = await harness.runSync();

      expect(first).toMatchObject({ added: 1, addFailed: 0 });
      expect([second, third, fourth]).toEqual([IDLE, IDLE, IDLE]);
      expect(harness.deletes).toEqual([]);
      expect(harness.writes).toBe(1);
      expect(harness.mappings).toHaveLength(1);
      expect(harness.remoteRanges()).toEqual([testCase.range]);
    });
  }
});

describe("outlook wall times that name a single instant", () => {
  const ambiguous: { instant: string; name: string; timeZone: string }[] = [
    {
      instant: "2027-11-07T06:30:00.000Z",
      name: "the second pass through a one-hour fall-back fold",
      timeZone: "America/New_York",
    },
    {
      instant: "2027-10-31T01:15:00.000Z",
      name: "the second pass through a European fall-back fold",
      timeZone: "Europe/Berlin",
    },
    {
      instant: "2027-04-03T15:10:00.000Z",
      name: "the second pass through a half-hour fall-back fold",
      timeZone: "Australia/Lord_Howe",
    },
  ];

  for (const testCase of ambiguous) {
    it(`resolves back to the instant it was given for ${testCase.name}`, () => {
      const startTime = new Date(testCase.instant);
      const serialized = serializeOutlookEvent(buildEvent({
        endTime: new Date(startTime.getTime() + 60 * 60 * 1000),
        startTime,
        startTimeZone: testCase.timeZone,
      }));

      const resolved = parseEventTime(serialized.start, serialized.isAllDay);

      expect(resolved?.toISOString()).toBe(testCase.instant);
    });
  }

  it("resolves back to the instant it was given for an unambiguous zoned wall time", () => {
    const startTime = new Date("2027-06-01T16:00:00.000Z");
    const serialized = serializeOutlookEvent(buildEvent({
      endTime: new Date("2027-06-01T17:00:00.000Z"),
      startTime,
      startTimeZone: "America/New_York",
    }));

    expect(parseEventTime(serialized.start, serialized.isAllDay)?.toISOString())
      .toBe("2027-06-01T16:00:00.000Z");
  });

  it("is the guarantee the ICS serializer already keeps for the same instants", () => {
    const resolved = ambiguous.map((testCase) => {
      const zonedDate = buildZonedIcsDate(
        new Date(testCase.instant),
        testCase.timeZone,
        false,
      );
      if (!zonedDate.local) {
        return zonedDate.date.toISOString();
      }
      return wallTimeToInstant(zonedDate.local.date, zonedDate.local.timezone).toISOString();
    });

    expect(resolved).toEqual(ambiguous.map((testCase) => testCase.instant));
  });
});
