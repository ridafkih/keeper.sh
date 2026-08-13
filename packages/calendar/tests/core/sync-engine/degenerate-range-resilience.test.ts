import { describe, expect, it } from "vitest";
import type { GoogleEvent } from "@keeper.sh/data-schemas";
import { syncCalendar } from "../../../src/core/sync-engine/index";
import type { CalendarSyncProvider, PendingChanges } from "../../../src/core/sync-engine/types";
import type {
  EventMapping,
  MaterializedSyncableEvent,
  RemoteEvent,
} from "../../../src/index";
import { createEditableEventContentHash } from "../../../src/core/events/content-hash";
import { normalizeGoogleEvent } from "../../../src/providers/google/destination/normalize-event";
import { serializeGoogleEvent } from "../../../src/providers/google/destination/serialize-event";
import { parseEventTime as parseGoogleEventTime } from "../../../src/providers/google/shared/date-time";

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

const POINT_IN_TIME = new Date("2027-03-08T16:00:00.000Z");

const buildEvent = (
  overrides: Partial<MaterializedSyncableEvent>,
): MaterializedSyncableEvent => ({
  availability: "busy",
  calendarId: "source-calendar",
  calendarName: "Source",
  calendarUrl: null,
  endTime: POINT_IN_TIME,
  eventStateId: "event-state-1",
  id: "event-state-1",
  sourceEventUid: "source-uid",
  startTime: POINT_IN_TIME,
  summary: "Point in time",
  ...overrides,
} as MaterializedSyncableEvent);

const toAvailability = (isFree: boolean): "busy" | "free" => {
  if (isFree) {
    return "free";
  }
  return "busy";
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

interface HarnessOptions {
  events: () => MaterializedSyncableEvent[];
  failPush?: (attempt: number) => boolean;
  swallowInserts?: (attempt: number) => boolean;
}

interface Harness {
  deletes: number;
  mappings: EventMapping[];
  pushAttempts: number;
  rejections: string[];
  stored: Map<string, GoogleEvent & { id: string }>;
  runSync: () => Promise<{
    added: number;
    addFailed: number;
    removed: number;
    removeFailed: number;
  }>;
}

const createGoogleHarness = (options: HarnessOptions): Harness => {
  const mappings: EventMapping[] = [];
  const stored = new Map<string, GoogleEvent & { id: string }>();
  const rejections: string[] = [];
  const counters = { deletes: 0, flushes: 0, nextRemoteId: 0, pushAttempts: 0 };

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
    pushEvents: (events) => Promise.resolve(events.map((event) => {
      counters.pushAttempts += 1;
      if (options.failPush?.(counters.pushAttempts) ?? false) {
        return { error: "backendError", success: false as const };
      }
      const uid = `keeper-${event.id}`;
      const payload = serializeGoogleEvent(event, uid);
      if (!payload) {
        return { error: "not serializable", success: false as const };
      }
      if (googleRejectsRange(payload)) {
        rejections.push("The specified time range is empty.");
        return { error: "The specified time range is empty.", success: false as const };
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
    get pushAttempts() {
      return counters.pushAttempts;
    },
    rejections,
    stored,
    runSync: () => syncCalendar({
      calendarId: DESTINATION_CALENDAR_ID,
      flush: (changes: PendingChanges) => {
        counters.flushes += 1;
        const swallow = options.swallowInserts?.(counters.flushes) ?? false;
        if (!swallow) {
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
        localEvents: options.events(),
        remoteEvents: await provider.listRemoteEvents({
          timeMin: WIDE_SCOPE.requestedWindow.timeMin,
        }),
      }),
      reconciliationScope: WIDE_SCOPE,
      userId: "user-1",
    }),
  } as Harness;
};

describe("degenerate range mirroring under partial failure", () => {
  it("retries a zero-duration event after a transient push failure and converges", async () => {
    const event = buildEvent({});
    const harness = createGoogleHarness({
      events: () => [event],
      failPush: (attempt) => attempt === 1,
    });

    const first = await harness.runSync();
    const second = await harness.runSync();
    const third = await harness.runSync();

    expect(first).toMatchObject({ added: 0, addFailed: 1 });
    expect(second).toMatchObject({ added: 1, addFailed: 0 });
    expect(third).toMatchObject({ added: 0, addFailed: 0, removed: 0 });
    expect(harness.stored.size).toBe(1);
    expect(harness.mappings).toHaveLength(1);
    expect(harness.rejections).toEqual([]);
  });

  it("recovers from a lost mapping write without leaving a duplicate mirror behind", async () => {
    const event = buildEvent({});
    const harness = createGoogleHarness({
      events: () => [event],
      swallowInserts: (flush) => flush === 1,
    });

    await harness.runSync();
    expect(harness.stored.size).toBe(1);
    expect(harness.mappings).toHaveLength(0);

    const second = await harness.runSync();
    const third = await harness.runSync();
    const fourth = await harness.runSync();

    expect(second.added).toBe(1);
    expect(third).toMatchObject({ added: 0, removed: 0 });
    expect(fourth).toMatchObject({ added: 0, removed: 0 });
    expect(harness.stored.size).toBe(1);
    expect(harness.mappings).toHaveLength(1);
  });
});

describe("degenerate range mirroring across changing source shapes", () => {
  it("does not churn when a zero-duration event turns inverted at the same start", async () => {
    const shapes = [
      buildEvent({}),
      buildEvent({ endTime: new Date("2027-03-08T15:00:00.000Z") }),
      buildEvent({ endTime: new Date("2027-03-08T15:30:00.000Z") }),
    ];
    let index = 0;
    const harness = createGoogleHarness({
      events: () => shapes.slice(index, index + 1),
    });

    const first = await harness.runSync();
    index = 1;
    const second = await harness.runSync();
    index = 2;
    const third = await harness.runSync();

    expect(first.added).toBe(1);
    expect(second).toMatchObject({ added: 0, removed: 0 });
    expect(third).toMatchObject({ added: 0, removed: 0 });
    expect(harness.deletes).toBe(0);
    expect(harness.stored.size).toBe(1);
  });

  it("replaces the mirror once when a zero-duration event gains a real duration", async () => {
    const shapes = [
      buildEvent({}),
      buildEvent({ endTime: new Date("2027-03-08T17:00:00.000Z") }),
    ];
    let index = 0;
    const harness = createGoogleHarness({
      events: () => shapes.slice(index, index + 1),
    });

    await harness.runSync();
    index = 1;
    const second = await harness.runSync();
    const third = await harness.runSync();

    expect(second.added).toBe(1);
    expect(third).toMatchObject({ added: 0, removed: 0 });
    expect(harness.stored.size).toBe(1);
    expect(harness.mappings).toHaveLength(1);
  });
});

describe("several degenerate events sharing one instant", () => {
  it("mirrors every zero-duration event on the same instant and converges", async () => {
    const events = [
      buildEvent({ eventStateId: "event-state-1", id: "event-state-1", summary: "First" }),
      buildEvent({ eventStateId: "event-state-2", id: "event-state-2", summary: "Second" }),
      buildEvent({ eventStateId: "event-state-3", id: "event-state-3", summary: "Third" }),
    ];
    const harness = createGoogleHarness({ events: () => events });

    const first = await harness.runSync();
    const second = await harness.runSync();
    const third = await harness.runSync();

    expect(first.added).toBe(3);
    expect(second).toMatchObject({ added: 0, removed: 0 });
    expect(third).toMatchObject({ added: 0, removed: 0 });
    expect(harness.stored.size).toBe(3);
    expect(harness.mappings).toHaveLength(3);
    expect(harness.deletes).toBe(0);
  });

  it("mirrors two zero-duration events that share an instant and a summary", async () => {
    const events = [
      buildEvent({ eventStateId: "event-state-1", id: "event-state-1" }),
      buildEvent({ eventStateId: "event-state-2", id: "event-state-2" }),
    ];
    const harness = createGoogleHarness({ events: () => events });

    const first = await harness.runSync();
    const second = await harness.runSync();

    expect(first.added).toBe(2);
    expect(second).toMatchObject({ added: 0, removed: 0 });
    expect(harness.stored.size).toBe(2);
    expect(harness.deletes).toBe(0);
  });
});

describe("degenerate events with absent optional fields", () => {
  const cases: { name: string; event: MaterializedSyncableEvent }[] = [
    {
      event: buildEvent({}),
      name: "no description, location or timezone",
    },
    {
      event: buildEvent({ description: "", location: "" }),
      name: "empty description and location",
    },
    {
      event: buildEvent({ availability: "free" }),
      name: "free availability",
    },
    {
      event: buildEvent({ summary: "" }),
      name: "no summary",
    },
  ];

  for (const testCase of cases) {
    it(`converges for a zero-duration event with ${testCase.name}`, async () => {
      const harness = createGoogleHarness({ events: () => [testCase.event] });

      const first = await harness.runSync();
      const second = await harness.runSync();
      const third = await harness.runSync();

      expect(first.added).toBe(1);
      expect(second).toMatchObject({ added: 0, removed: 0 });
      expect(third).toMatchObject({ added: 0, removed: 0 });
      expect(harness.deletes).toBe(0);
    });
  }
});
