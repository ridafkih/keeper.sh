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
import { normalizeGoogleEvent } from "../../../src/providers/google/destination/normalize-event";
import { normalizeOutlookEvent } from "../../../src/providers/outlook/destination/normalize-event";
import { serializeGoogleEvent } from "../../../src/providers/google/destination/serialize-event";
import { serializeOutlookEvent } from "../../../src/providers/outlook/destination/serialize-event";
import { parseEventTime as parseGoogleEventTime } from "../../../src/providers/google/shared/date-time";
import { parseEventTime as parseOutlookEventTime } from "../../../src/providers/outlook/shared/date-time";

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

const toAvailability = (isFree: boolean): "busy" | "free" => {
  if (isFree) {
    return "free";
  }
  return "busy";
};

const buildEvent = (
  overrides: Partial<MaterializedSyncableEvent>,
): MaterializedSyncableEvent => ({
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

interface HarnessOptions {
  events: MaterializedSyncableEvent[];
  scope?: typeof WIDE_SCOPE;
}

interface Harness {
  mappings: EventMapping[];
  pushRejections: string[];
  remoteCount: () => number;
  deleteCount: number;
  runSync: () => Promise<{ added: number; removed: number; addFailed: number; removeFailed: number }>;
}

const googleRejectsRange = (payload: GoogleEvent): boolean => {
  if (payload.start?.date && payload.end?.date) {
    return payload.end.date <= payload.start.date;
  }
  if (payload.start?.dateTime && payload.end?.dateTime) {
    return new Date(payload.end.dateTime).getTime() <= new Date(payload.start.dateTime).getTime();
  }
  return false;
};

const createGoogleHarness = (options: HarnessOptions): Harness => {
  const mappings: EventMapping[] = [];
  const stored = new Map<string, GoogleEvent & { id: string }>();
  const pushRejections: string[] = [];
  const harness = { deleteCount: 0 };

  const provider: CalendarSyncProvider = {
    deleteEvents: (eventIds) => {
      harness.deleteCount += eventIds.length;
      for (const eventId of eventIds) {
        stored.delete(eventId);
      }
      return Promise.resolve(eventIds.map(() => ({ success: true })));
    },
    listRemoteEvents: () => {
      const items = [...stored.values()].flatMap((event): RemoteEvent[] => {
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
      });
      return Promise.resolve({ items, rawItemCount: items.length });
    },
    normalizeEvent: normalizeGoogleEvent,
    pushEvents: (events) => Promise.resolve(events.map((event) => {
      const uid = `keeper-${event.id}`;
      const payload = serializeGoogleEvent(event, uid);
      if (!payload) {
        return { success: false as const, error: "not serializable" };
      }
      if (googleRejectsRange(payload)) {
        pushRejections.push("The specified time range is empty.");
        return { success: false as const, error: "The specified time range is empty." };
      }
      const deleteId = `google-${stored.size}`;
      stored.set(deleteId, { ...payload, id: deleteId });
      return { deleteId, remoteId: uid, success: true as const };
    })),
  };

  return {
    ...harness,
    mappings,
    pushRejections,
    remoteCount: () => stored.size,
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
          timeMin: WIDE_SCOPE.requestedWindow.timeMin,
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
  } as Harness;
};

const createOutlookHarness = (options: HarnessOptions): Harness => {
  const mappings: EventMapping[] = [];
  const stored = new Map<string, OutlookEvent & { iCalUId: string; id: string }>();
  const pushRejections: string[] = [];
  const harness = { deleteCount: 0 };

  const provider: CalendarSyncProvider = {
    deleteEvents: (eventIds) => {
      harness.deleteCount += eventIds.length;
      for (const eventId of eventIds) {
        stored.delete(eventId);
      }
      return Promise.resolve(eventIds.map(() => ({ success: true })));
    },
    listRemoteEvents: () => {
      const items = [...stored.values()].flatMap((event): RemoteEvent[] => {
        const startTime = parseOutlookEventTime(event.start, event.isAllDay);
        const endTime = parseOutlookEventTime(event.end, event.isAllDay);
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
            isAllDay: event.isAllDay,
            location: event.location?.displayName,
            startTime,
            summary: event.subject ?? "",
          }),
          endTime,
          isKeeperEvent: true,
          startTime,
          supportedAvailabilities: ["busy", "free", "oof", "workingElsewhere"],
          uid: event.iCalUId,
        }];
      });
      return Promise.resolve({ items, rawItemCount: items.length });
    },
    normalizeEvent: normalizeOutlookEvent,
    pushEvents: (events) => Promise.resolve(events.map((event) => {
      const payload = serializeOutlookEvent(event);
      const deleteId = `outlook-${stored.size}`;
      const uid = `keeper-${event.id}`;
      stored.set(deleteId, { ...payload, iCalUId: uid, id: deleteId });
      return { deleteId, remoteId: uid, success: true as const };
    })),
  };

  return {
    ...harness,
    mappings,
    pushRejections,
    remoteCount: () => stored.size,
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
          timeMin: WIDE_SCOPE.requestedWindow.timeMin,
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
  } as Harness;
};

const runThreeTimes = async (harness: Harness) => {
  const first = await harness.runSync();
  const second = await harness.runSync();
  const third = await harness.runSync();
  return { first, second, third };
};

describe("google destination convergence for degenerate ranges", () => {
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
        endTime: new Date("2027-03-08T23:59:30.000Z"),
        startTime: new Date("2027-03-08T23:59:30.000Z"),
      }),
      name: "zero-duration event whose widened end crosses midnight",
    },
    {
      event: buildEvent({
        endTime: new Date("2027-03-14T07:00:00.000Z"),
        startTime: new Date("2027-03-14T07:00:00.000Z"),
        startTimeZone: "America/New_York",
      }),
      name: "zero-duration event at a spring-forward transition",
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
  ];

  for (const testCase of cases) {
    it(`mirrors a ${testCase.name} and converges across repeated runs`, async () => {
      const harness = createGoogleHarness({ events: [testCase.event] });

      const { first, second, third } = await runThreeTimes(harness);

      expect(harness.pushRejections).toEqual([]);
      expect(first.added).toBe(1);
      expect(harness.remoteCount()).toBe(1);
      expect(second).toMatchObject({ added: 0, addFailed: 0, removed: 0, removeFailed: 0 });
      expect(third).toMatchObject({ added: 0, addFailed: 0, removed: 0, removeFailed: 0 });
      expect(harness.mappings).toHaveLength(1);
    });
  }
});

describe("outlook destination convergence for degenerate ranges", () => {
  const cases: { name: string; event: MaterializedSyncableEvent }[] = [
    {
      event: buildEvent({ startTimeZone: "UTC" }),
      name: "timed zero-duration event",
    },
    {
      event: buildEvent({
        endTime: new Date("2027-03-08T15:00:00.000Z"),
        startTime: new Date("2027-03-08T16:00:00.000Z"),
        startTimeZone: "UTC",
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
  ];

  for (const testCase of cases) {
    it(`mirrors a ${testCase.name} and converges across repeated runs`, async () => {
      const harness = createOutlookHarness({ events: [testCase.event] });

      const { first, second, third } = await runThreeTimes(harness);

      expect(first.added).toBe(1);
      expect(harness.remoteCount()).toBe(1);
      expect(second).toMatchObject({ added: 0, addFailed: 0, removed: 0, removeFailed: 0 });
      expect(third).toMatchObject({ added: 0, addFailed: 0, removed: 0, removeFailed: 0 });
      expect(harness.mappings).toHaveLength(1);
    });
  }
});

describe("degenerate ranges at the reconciliation window edge", () => {
  const windowStart = new Date("2027-03-08T16:00:00.000Z");
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

  it("keeps a google zero-duration event that starts exactly at the window lower edge", async () => {
    const harness = createGoogleHarness({
      events: [buildEvent({ endTime: windowStart, startTime: windowStart })],
      scope: edgeScope,
    });

    const { first, second, third } = await runThreeTimes(harness);

    expect(first.added).toBe(1);
    expect(second).toMatchObject({ added: 0, removed: 0 });
    expect(third).toMatchObject({ added: 0, removed: 0 });
    expect(harness.remoteCount()).toBe(1);
  });

  it("mirrors an outlook zero-duration event one millisecond inside the window lower edge", async () => {
    const inside = new Date(windowStart.getTime() + 1);
    const harness = createOutlookHarness({
      events: [buildEvent({ endTime: inside, startTime: inside, startTimeZone: "UTC" })],
      scope: edgeScope,
    });

    const { first, second, third } = await runThreeTimes(harness);

    expect(first.added).toBe(1);
    expect(second).toMatchObject({ added: 0, removed: 0 });
    expect(third).toMatchObject({ added: 0, removed: 0 });
    expect(harness.remoteCount()).toBe(1);
  });

  it("keeps an outlook zero-duration event that starts exactly at the window lower edge", async () => {
    const harness = createOutlookHarness({
      events: [buildEvent({
        endTime: windowStart,
        startTime: windowStart,
        startTimeZone: "UTC",
      })],
      scope: edgeScope,
    });

    const { first, second, third } = await runThreeTimes(harness);

    expect(first.added).toBe(1);
    expect(second).toMatchObject({ added: 0, removed: 0 });
    expect(third).toMatchObject({ added: 0, removed: 0 });
    expect(harness.remoteCount()).toBe(1);
  });
});
