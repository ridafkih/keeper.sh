import type { GoogleEvent } from "@keeper.sh/data-schemas";
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
} from "../../../../src/index";
import { createEditableEventContentHash } from "../../../../src/core/events/content-hash";
import { generateDeterministicEventUid } from "../../../../src/core/events/identity";
import { normalizeGoogleEvent } from "../../../../src/providers/google/destination/normalize-event";
import { serializeGoogleEvent } from "../../../../src/providers/google/destination/serialize-event";
import { parseEventTime } from "../../../../src/providers/google/shared/date-time";

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
  rejections: string[];
  runSync: () => Promise<RunOutcome>;
  writes: () => number;
}

const toGoogleAvailability = (transparency: GoogleEvent["transparency"]) => {
  if (transparency === "transparent") {
    return "free";
  }
  return "busy";
};

const createGoogleHarness = (events: () => MaterializedSyncableEvent[]): Harness => {
  const mappings: EventMapping[] = [];
  const resources = new Map<string, GoogleEvent>();
  const deletes: string[] = [];
  const rejections: string[] = [];
  let nextRemoteId = 1;
  let writes = 0;

  const toRemoteEvent = (id: string, stored: GoogleEvent): RemoteEvent | null => {
    const startTime = parseEventTime(stored.start);
    const endTime = parseEventTime(stored.end);
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

  const listRemoteEvents = (): Promise<RemoteEvent[]> => Promise.resolve(
    [...resources.entries()].flatMap(([id, stored]) => {
      const remoteEvent = toRemoteEvent(id, stored);
      if (!remoteEvent) {
        return [];
      }
      return [remoteEvent];
    }),
  );

  const provider: CalendarSyncProvider = {
    deleteEvents: (eventIds) => {
      for (const id of eventIds) {
        deletes.push(id);
        resources.delete(id);
      }
      return Promise.resolve(eventIds.map(() => ({ success: true })));
    },
    listRemoteEvents,
    normalizeEvent: normalizeGoogleEvent,
    pushEvents: (pushed) => Promise.resolve(pushed.map((event) => {
      const uid = generateDeterministicEventUid(event.id);
      const serialized = serializeGoogleEvent(event, uid);
      if (!serialized) {
        rejections.push(`unserializable:${uid}`);
        return { error: "Event cannot be serialized for Google", success: false as const };
      }
      const start = parseEventTime(serialized.start);
      const end = parseEventTime(serialized.end);
      if (!start || !end || end.getTime() <= start.getTime()) {
        rejections.push(`empty-range:${uid}`);
        return { error: "The specified time range is empty.", success: false as const };
      }
      const googleEventId = `google-${nextRemoteId++}`;
      resources.set(googleEventId, serialized);
      writes += 1;
      return { deleteId: googleEventId, remoteId: uid, success: true as const };
    })),
  };

  return {
    deletes,
    mappings,
    rejections,
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
        readState: async () => ({
          existingMappings: [...mappings],
          localEvents: events(),
          remoteEvents: await listRemoteEvents(),
        }),
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
    writes: () => writes,
  };
};

const IDLE = { added: 0, addFailed: 0, removed: 0, removeFailed: 0 };

describe("google destination convergence across repeated runs", () => {
  const cases: { event: MaterializedSyncableEvent; name: string; range: string }[] = [
    {
      event: buildEvent({
        endTime: new Date("2027-06-01T16:00:00.000Z"),
        startTime: new Date("2027-06-01T16:00:00.000Z"),
      }),
      name: "zero-duration timed event",
      range: "2027-06-01T16:00:00.000Z/2027-06-01T16:01:00.000Z",
    },
    {
      event: buildEvent({
        endTime: new Date("2027-05-31T16:00:00.000Z"),
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
        endTime: new Date("2027-05-28T00:00:00.000Z"),
        isAllDay: true,
        startTime: new Date("2027-06-01T00:00:00.000Z"),
      }),
      name: "inverted multi-day all-day event",
      range: "2027-06-01T00:00:00.000Z/2027-06-02T00:00:00.000Z",
    },
    {
      event: buildEvent({
        endTime: new Date("2027-11-07T06:00:00.000Z"),
        startTime: new Date("2027-11-07T05:30:00.000Z"),
        startTimeZone: "America/New_York",
      }),
      name: "zoned event inside the repeated fall-back hour",
      range: "2027-11-07T05:30:00.000Z/2027-11-07T06:00:00.000Z",
    },
    {
      event: buildEvent({
        endTime: new Date("2027-12-31T23:59:30.000Z"),
        startTime: new Date("2027-12-31T23:59:30.000Z"),
      }),
      name: "zero-duration event whose widened end crosses a year boundary",
      range: "2027-12-31T23:59:30.000Z/2028-01-01T00:00:30.000Z",
    },
  ];

  for (const testCase of cases) {
    it(`mirrors a ${testCase.name} once and stops`, async () => {
      const harness = createGoogleHarness(() => [testCase.event]);

      const first = await harness.runSync();
      const rest = [
        await harness.runSync(),
        await harness.runSync(),
        await harness.runSync(),
      ];

      expect(harness.rejections).toEqual([]);
      expect(first).toMatchObject({ added: 1, addFailed: 0 });
      expect(rest).toEqual([IDLE, IDLE, IDLE]);
      expect(harness.deletes).toEqual([]);
      expect(harness.writes()).toBe(1);
      expect(harness.mappings).toHaveLength(1);
      expect(harness.remoteRanges()).toEqual([testCase.range]);
    });
  }

  it("does not rewrite the mirror when an all-day range moves within the day it names", async () => {
    let current = buildEvent({
      endTime: new Date("2027-06-01T17:00:00.000Z"),
      isAllDay: true,
      startTime: new Date("2027-06-01T09:00:00.000Z"),
    });
    const harness = createGoogleHarness(() => [current]);

    expect(await harness.runSync()).toMatchObject({ added: 1 });
    expect(await harness.runSync()).toMatchObject(IDLE);

    current = buildEvent({
      endTime: new Date("2027-06-01T21:45:00.000Z"),
      isAllDay: true,
      startTime: new Date("2027-06-01T04:15:00.000Z"),
    });

    expect(await harness.runSync()).toMatchObject(IDLE);
    expect(await harness.runSync()).toMatchObject(IDLE);
    expect(harness.writes()).toBe(1);
    expect(harness.deletes).toEqual([]);
    expect(harness.remoteRanges()).toEqual([
      "2027-06-01T00:00:00.000Z/2027-06-02T00:00:00.000Z",
    ]);
  });

  it("settles again after a timed range collapses to a point and is restored", async () => {
    const timed = buildEvent({});
    const collapsed = buildEvent({
      endTime: new Date("2027-06-01T16:00:00.000Z"),
      startTime: new Date("2027-06-01T16:00:00.000Z"),
    });
    let current = timed;
    const harness = createGoogleHarness(() => [current]);

    expect(await harness.runSync()).toMatchObject({ added: 1 });
    expect(await harness.runSync()).toMatchObject(IDLE);

    current = collapsed;
    const collapsedRun = await harness.runSync();
    expect(collapsedRun.addFailed).toBe(0);
    expect(await harness.runSync()).toMatchObject(IDLE);
    expect(harness.remoteRanges()).toEqual([
      "2027-06-01T16:00:00.000Z/2027-06-01T16:01:00.000Z",
    ]);

    current = timed;
    const restoredRun = await harness.runSync();
    expect(restoredRun.addFailed).toBe(0);
    expect(await harness.runSync()).toMatchObject(IDLE);
    expect(harness.remoteRanges()).toEqual([
      "2027-06-01T16:00:00.000Z/2027-06-01T17:00:00.000Z",
    ]);
    expect(harness.mappings).toHaveLength(1);
    expect(harness.rejections).toEqual([]);
  });
});
