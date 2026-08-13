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
import { normalizeCalDAVEvent } from "../../../../src/providers/caldav/destination/normalize-event";
import {
  eventToICalString,
  parseICalToRemoteEvent,
} from "../../../../src/providers/caldav/shared/ics";

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
  events: () => MaterializedSyncableEvent[];
  mappings?: EventMapping[];
  rejectPush?: (event: MaterializedSyncableEvent) => string | null;
  scope?: typeof WIDE_SCOPE;
}

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
  writes: string[];
}

const createCalDAVHarness = (options: HarnessOptions): Harness => {
  const mappings: EventMapping[] = options.mappings ?? [];
  const resources = new Map<string, string>();
  const writes: string[] = [];
  const deletes: string[] = [];
  const scope = options.scope ?? WIDE_SCOPE;

  const listRemoteEvents = (listOptions: { timeMin: Date }): Promise<RemoteEvent[]> => {
    const remoteEvents: RemoteEvent[] = [];
    for (const iCalString of resources.values()) {
      const parsed = parseICalToRemoteEvent(iCalString);
      if (!parsed || parsed.endTime < listOptions.timeMin) {
        continue;
      }
      const availability = parsed.availability ?? "busy";
      remoteEvents.push({
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
      } as RemoteEvent);
    }
    return Promise.resolve(remoteEvents);
  };

  const provider: CalendarSyncProvider = {
    deleteEvents: (eventIds) => {
      for (const uid of eventIds) {
        deletes.push(uid);
        resources.delete(uid);
      }
      return Promise.resolve(eventIds.map(() => ({ success: true })));
    },
    listRemoteEvents,
    normalizeEvent: normalizeCalDAVEvent,
    pushEvents: (events) => Promise.resolve(events.map((event) => {
      const uid = generateDeterministicEventUid(event.id);
      const rejection = options.rejectPush?.(event);
      if (rejection) {
        writes.push(`rejected:${uid}`);
        return { error: rejection, success: false as const };
      }
      const iCalString = eventToICalString(event, uid);
      resources.set(uid, iCalString);
      writes.push(uid);
      return { deleteId: uid, remoteId: uid, success: true as const };
    })),
  };

  return {
    deletes,
    mappings,
    remoteRanges: () => [...resources.values()].flatMap((iCalString) => {
      const parsed = parseICalToRemoteEvent(iCalString);
      if (!parsed) {
        return [];
      }
      return [`${parsed.startTime.toISOString()}/${parsed.endTime.toISOString()}`];
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
          localEvents: options.events(),
          remoteEvents: await listRemoteEvents({ timeMin: scope.requestedWindow.timeMin }),
        }),
        reconciliationScope: scope,
        userId: "user-1",
      });
      return {
        added: result.added,
        addFailed: result.addFailed,
        removed: result.removed,
        removeFailed: result.removeFailed,
      };
    },
    writes,
  };
};

const IDLE = { added: 0, addFailed: 0, removed: 0, removeFailed: 0 };

describe("caldav destination convergence for degenerate ranges", () => {
  const cases: { name: string; event: MaterializedSyncableEvent; range: string }[] = [
    {
      event: buildEvent({}),
      name: "timed zero-duration event",
      range: "2027-03-08T16:00:00.000Z/2027-03-08T16:01:00.000Z",
    },
    {
      event: buildEvent({
        endTime: new Date("2027-03-08T15:00:00.000Z"),
        startTime: new Date("2027-03-08T16:00:00.000Z"),
      }),
      name: "timed inverted event",
      range: "2027-03-08T16:00:00.000Z/2027-03-08T16:01:00.000Z",
    },
    {
      event: buildEvent({
        endTime: new Date("2027-03-08T00:00:00.000Z"),
        isAllDay: true,
        startTime: new Date("2027-03-08T00:00:00.000Z"),
      }),
      name: "same-date all-day event",
      range: "2027-03-08T00:00:00.000Z/2027-03-09T00:00:00.000Z",
    },
    {
      event: buildEvent({
        endTime: new Date("2027-03-05T00:00:00.000Z"),
        isAllDay: true,
        startTime: new Date("2027-03-10T00:00:00.000Z"),
      }),
      name: "inverted multi-day all-day event",
      range: "2027-03-10T00:00:00.000Z/2027-03-11T00:00:00.000Z",
    },
    {
      event: buildEvent({
        endTime: new Date("2027-03-14T07:00:00.000Z"),
        startTime: new Date("2027-03-14T07:00:00.000Z"),
        startTimeZone: "America/New_York",
      }),
      name: "zero-duration event at a spring-forward transition",
      range: "2027-03-14T07:00:00.000Z/2027-03-14T07:01:00.000Z",
    },
    {
      event: buildEvent({
        endTime: new Date("2027-03-08T23:59:30.000Z"),
        startTime: new Date("2027-03-08T23:59:30.000Z"),
      }),
      name: "zero-duration event whose widened end crosses midnight",
      range: "2027-03-08T23:59:30.000Z/2027-03-09T00:00:30.000Z",
    },
  ];

  for (const testCase of cases) {
    it(`mirrors a ${testCase.name} and converges across repeated runs`, async () => {
      const harness = createCalDAVHarness({ events: () => [testCase.event] });

      const first = await harness.runSync();
      const second = await harness.runSync();
      const third = await harness.runSync();

      expect(first).toMatchObject({ added: 1, addFailed: 0 });
      expect(harness.remoteRanges()).toEqual([testCase.range]);
      expect(second).toMatchObject(IDLE);
      expect(third).toMatchObject(IDLE);
      expect(harness.mappings).toHaveLength(1);
      expect(harness.deletes).toEqual([]);
      expect(harness.writes).toHaveLength(1);
    });
  }

  it("keeps a zero-duration event that starts exactly on the window lower edge", async () => {
    const windowStart = new Date("2027-03-08T16:00:00.000Z");
    const scope = {
      authoritativeWindow: {
        timeMax: new Date("2027-06-01T00:00:00.000Z"),
        timeMin: windowStart,
      },
      requestedWindow: {
        timeMax: new Date("2027-06-01T00:00:00.000Z"),
        timeMin: windowStart,
      },
    };
    const harness = createCalDAVHarness({
      events: () => [buildEvent({ endTime: windowStart, startTime: windowStart })],
      scope,
    });

    const first = await harness.runSync();
    const second = await harness.runSync();
    const third = await harness.runSync();

    expect(first).toMatchObject({ added: 1, addFailed: 0 });
    expect(second).toMatchObject(IDLE);
    expect(third).toMatchObject(IDLE);
    expect(harness.remoteRanges()).toHaveLength(1);
    expect(harness.deletes).toEqual([]);
  });

  it("repairs a mapping recorded before normalization exactly once", async () => {
    const event = buildEvent({});
    const uid = generateDeterministicEventUid(event.id);
    const legacyMapping = {
      calendarId: DESTINATION_CALENDAR_ID,
      deleteIdentifier: uid,
      destinationEventUid: uid,
      endTime: event.endTime,
      eventStateId: event.eventStateId,
      id: "mapping-legacy",
      sourceCalendarId: event.calendarId,
      startTime: event.startTime,
      syncEventHash: "stale-hash-from-before-normalization",
      syncEventId: event.id,
    } as EventMapping;
    const harness = createCalDAVHarness({
      events: () => [event],
      mappings: [legacyMapping],
    });

    const first = await harness.runSync();
    const second = await harness.runSync();
    const third = await harness.runSync();

    expect(first.added).toBe(1);
    expect(second).toMatchObject(IDLE);
    expect(third).toMatchObject(IDLE);
    expect(harness.mappings).toHaveLength(1);
    expect(harness.remoteRanges()).toEqual([
      "2027-03-08T16:00:00.000Z/2027-03-08T16:01:00.000Z",
    ]);
  });

  it("settles again after a source event collapses to zero duration and is restored", async () => {
    const timed = buildEvent({
      endTime: new Date("2027-03-08T17:00:00.000Z"),
      startTime: new Date("2027-03-08T16:00:00.000Z"),
    });
    const collapsed = buildEvent({});
    let current = timed;
    const harness = createCalDAVHarness({ events: () => [current] });

    expect(await harness.runSync()).toMatchObject({ added: 1 });
    expect(await harness.runSync()).toMatchObject(IDLE);

    current = collapsed;
    const afterCollapse = await harness.runSync();
    const collapseSettled = await harness.runSync();

    expect(afterCollapse.addFailed).toBe(0);
    expect(collapseSettled).toMatchObject(IDLE);
    expect(harness.remoteRanges()).toEqual([
      "2027-03-08T16:00:00.000Z/2027-03-08T16:01:00.000Z",
    ]);

    current = timed;
    const afterRestore = await harness.runSync();
    const restoreSettled = await harness.runSync();

    expect(afterRestore.addFailed).toBe(0);
    expect(restoreSettled).toMatchObject(IDLE);
    expect(harness.remoteRanges()).toEqual([
      "2027-03-08T16:00:00.000Z/2027-03-08T17:00:00.000Z",
    ]);
    expect(harness.mappings).toHaveLength(1);
  });

  it("retries a degenerate event after a transient push failure and then settles", async () => {
    let attempts = 0;
    const harness = createCalDAVHarness({
      events: () => [buildEvent({})],
      rejectPush: () => {
        attempts += 1;
        if (attempts === 1) {
          return "503 Service Unavailable";
        }
        return null;
      },
    });

    const first = await harness.runSync();
    expect(first).toMatchObject({ added: 0, addFailed: 1 });
    expect(harness.mappings).toEqual([]);

    const second = await harness.runSync();
    const third = await harness.runSync();

    expect(second).toMatchObject({ added: 1, addFailed: 0 });
    expect(third).toMatchObject(IDLE);
    expect(harness.mappings).toHaveLength(1);
    expect(harness.remoteRanges()).toEqual([
      "2027-03-08T16:00:00.000Z/2027-03-08T16:01:00.000Z",
    ]);
  });

  it("does not accumulate mappings or deletes while a push keeps failing", async () => {
    const harness = createCalDAVHarness({
      events: () => [buildEvent({})],
      rejectPush: () => "403 Forbidden",
    });

    const outcomes = [
      await harness.runSync(),
      await harness.runSync(),
      await harness.runSync(),
    ];

    for (const outcome of outcomes) {
      expect(outcome).toMatchObject({ added: 0, addFailed: 1, removed: 0 });
    }
    expect(harness.mappings).toEqual([]);
    expect(harness.deletes).toEqual([]);
    expect(harness.remoteRanges()).toEqual([]);
  });

  it("converges with a mixed batch of degenerate and ordinary events", async () => {
    const events = [
      buildEvent({ eventStateId: "a", id: "a" }),
      buildEvent({
        endTime: new Date("2027-03-08T00:00:00.000Z"),
        eventStateId: "b",
        id: "b",
        isAllDay: true,
        startTime: new Date("2027-03-08T00:00:00.000Z"),
      }),
      buildEvent({
        endTime: new Date("2027-03-09T12:00:00.000Z"),
        eventStateId: "c",
        id: "c",
        startTime: new Date("2027-03-09T11:00:00.000Z"),
      }),
      buildEvent({
        endTime: new Date("2027-03-10T09:00:00.000Z"),
        eventStateId: "d",
        id: "d",
        startTime: new Date("2027-03-10T10:00:00.000Z"),
      }),
    ];
    const harness = createCalDAVHarness({ events: () => events });

    const first = await harness.runSync();
    const second = await harness.runSync();
    const third = await harness.runSync();

    expect(first).toMatchObject({ added: 4, addFailed: 0 });
    expect(second).toMatchObject(IDLE);
    expect(third).toMatchObject(IDLE);
    expect(harness.mappings).toHaveLength(4);
    expect(harness.deletes).toEqual([]);
    expect(harness.remoteRanges().toSorted()).toEqual([
      "2027-03-08T00:00:00.000Z/2027-03-09T00:00:00.000Z",
      "2027-03-08T16:00:00.000Z/2027-03-08T16:01:00.000Z",
      "2027-03-09T11:00:00.000Z/2027-03-09T12:00:00.000Z",
      "2027-03-10T10:00:00.000Z/2027-03-10T10:01:00.000Z",
    ]);
  });
});
