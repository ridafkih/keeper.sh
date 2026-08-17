import { describe, expect, it } from "vitest";
import type { GoogleEvent, OutlookEvent } from "@keeper.sh/data-schemas";
import { syncCalendar } from "../../../src/core/sync-engine/index";
import type { CalendarSyncProvider, PendingChanges } from "../../../src/core/sync-engine/types";
import type {
  EventMapping,
  MaterializedSyncableEvent,
  RemoteEvent,
  RemoteEventListing,
} from "../../../src/index";
import { createEditableEventContentHash } from "../../../src/core/events/content-hash";
import { isEventInDestinationReconciliationWindow } from "../../../src/core/events/events";
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
const SOURCE_CALENDAR_ID = "source-calendar";

interface WindowShape {
  timeMax: Date;
  timeMin: Date;
}

interface ScopeShape {
  authoritativeWindow: WindowShape | null;
  requestedWindow: WindowShape;
}

const createScope = (timeMin: Date, timeMax: Date): ScopeShape => ({
  authoritativeWindow: { timeMax, timeMin },
  requestedWindow: { timeMax, timeMin },
});

const WIDE_SCOPE = createScope(
  new Date("2000-01-01T00:00:00.000Z"),
  new Date("2100-01-01T00:00:00.000Z"),
);

const buildEvent = (
  overrides: Partial<MaterializedSyncableEvent>,
): MaterializedSyncableEvent => ({
  availability: "busy",
  calendarId: SOURCE_CALENDAR_ID,
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

interface RunResult {
  added: number;
  addFailed: number;
  removed: number;
  removeFailed: number;
}

interface Harness {
  mappings: EventMapping[];
  pushFailures: string[];
  remoteRanges: () => { end: string; start: string }[];
  runSync: () => Promise<RunResult>;
  setEvents: (events: MaterializedSyncableEvent[]) => void;
  setRejectPush: (reject: boolean) => void;
  setScope: (scope: ScopeShape) => void;
  totalDeletes: () => number;
  totalWrites: () => number;
}

interface HarnessOptions {
  events: MaterializedSyncableEvent[];
  mappings?: EventMapping[];
  scope?: ScopeShape;
}

const toAvailability = (isFree: boolean): "busy" | "free" => {
  if (isFree) {
    return "free";
  }
  return "busy";
};

const applyChanges = (mappings: EventMapping[], changes: PendingChanges): void => {
  for (const insert of changes.inserts) {
    mappings.push({
      calendarId: insert.calendarId,
      deleteIdentifier: insert.deleteIdentifier,
      destinationEventUid: insert.destinationEventUid,
      endTime: insert.endTime,
      eventStateId: insert.eventStateId,
      id: `mapping-${mappings.length}-${Date.now()}`,
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
  for (const update of changes.updates ?? []) {
    const mapping = mappings.find((candidate) => candidate.id === update.id);
    if (mapping) {
      const { id: _id, ...assignments } = update;
      Object.assign(mapping, assignments);
    }
  }
};

const toRangeText = (startTime: Date, endTime: Date): { end: string; start: string } => ({
  end: endTime.toISOString(),
  start: startTime.toISOString(),
});

const readLocalEvents = (
  events: MaterializedSyncableEvent[],
  scope: ScopeShape,
): MaterializedSyncableEvent[] => events.filter((event) =>
  isEventInDestinationReconciliationWindow(event, scope.requestedWindow.timeMin));

const createSharedState = (options: HarnessOptions) => ({
  counters: { deletes: 0, writes: 0 },
  events: options.events,
  pushFailures: [] as string[],
  rejectPush: false,
  scope: options.scope ?? WIDE_SCOPE,
});

const createGoogleHarness = (options: HarnessOptions): Harness => {
  const mappings: EventMapping[] = options.mappings ?? [];
  const stored = new Map<string, GoogleEvent & { id: string }>();
  const state = createSharedState(options);
  let nextRemoteId = 0;

  const listRemoteEvents = (listOptions: { timeMax: Date; timeMin: Date }): Promise<RemoteEventListing> => {
    const items = [...stored.values()].flatMap((event): RemoteEvent[] => {
      const startTime = parseGoogleEventTime(event.start);
      const endTime = parseGoogleEventTime(event.end);
      if (!startTime || !endTime || endTime < listOptions.timeMin) {
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
  };

  const provider: CalendarSyncProvider = {
    deleteEvents: (eventIds) => {
      state.counters.deletes += eventIds.length;
      for (const eventId of eventIds) {
        stored.delete(eventId);
      }
      return Promise.resolve(eventIds.map(() => ({ success: true })));
    },
    listRemoteEvents,
    normalizeEvent: normalizeGoogleEvent,
    pushEvents: (events) => Promise.resolve(events.map((event) => {
      if (state.rejectPush) {
        state.pushFailures.push("rejected");
        return { success: false as const, error: "rejected" };
      }
      const uid = `keeper-${event.id}`;
      const payload = serializeGoogleEvent(event, uid);
      if (!payload) {
        state.pushFailures.push("not serializable");
        return { success: false as const, error: "not serializable" };
      }
      const startsAfterEnd = Boolean(payload.start?.dateTime && payload.end?.dateTime
        && new Date(payload.end.dateTime).getTime()
          <= new Date(payload.start.dateTime).getTime());
      const emptyDateRange = Boolean(payload.start?.date && payload.end?.date
        && payload.end.date <= payload.start.date);
      if (startsAfterEnd || emptyDateRange) {
        state.pushFailures.push("The specified time range is empty.");
        return { success: false as const, error: "The specified time range is empty." };
      }
      nextRemoteId += 1;
      const deleteId = `google-${nextRemoteId}`;
      state.counters.writes += 1;
      stored.set(deleteId, { ...payload, id: deleteId });
      return { deleteId, remoteId: uid, success: true as const };
    })),
  };

  return {
    mappings,
    pushFailures: state.pushFailures,
    remoteRanges: () => [...stored.values()].flatMap((event) => {
      const startTime = parseGoogleEventTime(event.start);
      const endTime = parseGoogleEventTime(event.end);
      if (!startTime || !endTime) {
        return [];
      }
      return [toRangeText(startTime, endTime)];
    }),
    runSync: () => syncCalendar({
      calendarId: DESTINATION_CALENDAR_ID,
      flush: (changes: PendingChanges) => {
        applyChanges(mappings, changes);
        return Promise.resolve();
      },
      isCurrent: () => Promise.resolve(true),
      provider,
      readState: async () => {
        const listing = await listRemoteEvents({ timeMax: new Date("2099-01-01T00:00:00.000Z"), timeMin: state.scope.requestedWindow.timeMin });
        return {
          existingMappings: [...mappings],
          localEvents: readLocalEvents(state.events, state.scope),
          remoteEvents: listing.items,
          remoteRawItemCount: listing.rawItemCount,
        };
      },
      reconciliationScope: state.scope,
      userId: "user-1",
    }),
    setEvents: (events) => {
      state.events = events;
    },
    setRejectPush: (reject) => {
      state.rejectPush = reject;
    },
    setScope: (scope) => {
      state.scope = scope;
    },
    totalDeletes: () => state.counters.deletes,
    totalWrites: () => state.counters.writes,
  };
};

const createOutlookHarness = (options: HarnessOptions): Harness => {
  const mappings: EventMapping[] = options.mappings ?? [];
  const stored = new Map<string, OutlookEvent & { iCalUId: string; id: string }>();
  const state = createSharedState(options);
  let nextRemoteId = 0;

  const readRange = (
    event: OutlookEvent,
  ): { endTime: Date; startTime: Date } | null => {
    const startTime = parseOutlookEventTime(event.start, event.isAllDay);
    const endTime = parseOutlookEventTime(event.end, event.isAllDay);
    if (!startTime || !endTime) {
      return null;
    }
    return { endTime, startTime };
  };

  const listRemoteEvents = (listOptions: { timeMax: Date; timeMin: Date }): Promise<RemoteEventListing> => {
    const items = [...stored.values()].flatMap((event): RemoteEvent[] => {
      const range = readRange(event);
      if (!range || range.endTime < listOptions.timeMin) {
        return [];
      }
      const availability = toAvailability(event.showAs === "free");
      return [{
        deleteId: event.id,
        editableAvailability: availability,
        editableContentHash: createEditableEventContentHash({
          availability,
          description: event.body?.content,
          endTime: range.endTime,
          isAllDay: event.isAllDay,
          location: event.location?.displayName,
          startTime: range.startTime,
          summary: event.subject ?? "",
        }),
        endTime: range.endTime,
        isKeeperEvent: true,
        startTime: range.startTime,
        supportedAvailabilities: ["busy", "free", "oof", "workingElsewhere"],
        uid: event.iCalUId,
      }];
    });
    return Promise.resolve({ items, rawItemCount: items.length });
  };

  const provider: CalendarSyncProvider = {
    deleteEvents: (eventIds) => {
      state.counters.deletes += eventIds.length;
      for (const eventId of eventIds) {
        stored.delete(eventId);
      }
      return Promise.resolve(eventIds.map(() => ({ success: true })));
    },
    listRemoteEvents,
    normalizeEvent: normalizeOutlookEvent,
    pushEvents: (events) => Promise.resolve(events.map((event) => {
      if (state.rejectPush) {
        state.pushFailures.push("rejected");
        return { success: false as const, error: "rejected" };
      }
      const payload = serializeOutlookEvent(event);
      const range = readRange(payload);
      if (!range || range.endTime.getTime() < range.startTime.getTime()) {
        state.pushFailures.push("The end date must be after the start date.");
        return { success: false as const, error: "The end date must be after the start date." };
      }
      if (payload.isAllDay
        && range.endTime.getTime() - range.startTime.getTime() < 24 * 60 * 60 * 1000) {
        state.pushFailures.push("All-day events must span whole days.");
        return { success: false as const, error: "All-day events must span whole days." };
      }
      nextRemoteId += 1;
      const deleteId = `outlook-${nextRemoteId}`;
      const uid = `keeper-${event.id}`;
      state.counters.writes += 1;
      stored.set(deleteId, { ...payload, iCalUId: uid, id: deleteId });
      return { deleteId, remoteId: uid, success: true as const };
    })),
  };

  return {
    mappings,
    pushFailures: state.pushFailures,
    remoteRanges: () => [...stored.values()].flatMap((event) => {
      const range = readRange(event);
      if (!range) {
        return [];
      }
      return [toRangeText(range.startTime, range.endTime)];
    }),
    runSync: () => syncCalendar({
      calendarId: DESTINATION_CALENDAR_ID,
      flush: (changes: PendingChanges) => {
        applyChanges(mappings, changes);
        return Promise.resolve();
      },
      isCurrent: () => Promise.resolve(true),
      provider,
      readState: async () => {
        const listing = await listRemoteEvents({ timeMax: new Date("2099-01-01T00:00:00.000Z"), timeMin: state.scope.requestedWindow.timeMin });
        return {
          existingMappings: [...mappings],
          localEvents: readLocalEvents(state.events, state.scope),
          remoteEvents: listing.items,
          remoteRawItemCount: listing.rawItemCount,
        };
      },
      reconciliationScope: state.scope,
      userId: "user-1",
    }),
    setEvents: (events) => {
      state.events = events;
    },
    setRejectPush: (reject) => {
      state.rejectPush = reject;
    },
    setScope: (scope) => {
      state.scope = scope;
    },
    totalDeletes: () => state.counters.deletes,
    totalWrites: () => state.counters.writes,
  };
};

const createCalDAVHarness = (options: HarnessOptions): Harness => {
  const mappings: EventMapping[] = options.mappings ?? [];
  const resources = new Map<string, string>();
  const state = createSharedState(options);

  const readResources = () => parseICalCalendarsToRemoteEvents([...resources.values()], {
    rejectUnsupportedRecurrenceDates: false,
  }).events;

  const listRemoteEvents = (listOptions: { timeMax: Date; timeMin: Date }): Promise<RemoteEventListing> => {
    const items = readResources().flatMap((event): RemoteEvent[] => {
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
  };

  const provider: CalendarSyncProvider = {
    deleteEvents: (eventIds) => {
      state.counters.deletes += eventIds.length;
      for (const eventId of eventIds) {
        resources.delete(eventId);
      }
      return Promise.resolve(eventIds.map(() => ({ success: true })));
    },
    listRemoteEvents,
    normalizeEvent: normalizeCalDAVEvent,
    pushEvents: (events) => Promise.resolve(events.map((event) => {
      if (state.rejectPush) {
        state.pushFailures.push("rejected");
        return { success: false as const, error: "rejected" };
      }
      const uid = generateDeterministicEventUid(event.id);
      state.counters.writes += 1;
      resources.set(uid, eventToICalString(event, uid));
      return { deleteId: uid, remoteId: uid, success: true as const };
    })),
  };

  return {
    mappings,
    pushFailures: state.pushFailures,
    remoteRanges: () => readResources().map((event) => toRangeText(event.startTime, event.endTime)),
    runSync: () => syncCalendar({
      calendarId: DESTINATION_CALENDAR_ID,
      flush: (changes: PendingChanges) => {
        applyChanges(mappings, changes);
        return Promise.resolve();
      },
      isCurrent: () => Promise.resolve(true),
      provider,
      readState: async () => {
        const listing = await listRemoteEvents({ timeMax: new Date("2099-01-01T00:00:00.000Z"), timeMin: state.scope.requestedWindow.timeMin });
        return {
          existingMappings: [...mappings],
          localEvents: readLocalEvents(state.events, state.scope),
          remoteEvents: listing.items,
          remoteRawItemCount: listing.rawItemCount,
        };
      },
      reconciliationScope: state.scope,
      userId: "user-1",
    }),
    setEvents: (events) => {
      state.events = events;
    },
    setRejectPush: (reject) => {
      state.rejectPush = reject;
    },
    setScope: (scope) => {
      state.scope = scope;
    },
    totalDeletes: () => state.counters.deletes,
    totalWrites: () => state.counters.writes,
  };
};

const HARNESS_FACTORIES: { create: (options: HarnessOptions) => Harness; name: string }[] = [
  { create: createGoogleHarness, name: "google" },
  { create: createOutlookHarness, name: "outlook" },
  { create: createCalDAVHarness, name: "caldav" },
];

const QUIET: RunResult = { added: 0, addFailed: 0, removed: 0, removeFailed: 0 };

const INSTANT = new Date("2027-03-08T16:00:00.000Z");
const ALL_DAY_INSTANT = new Date("2027-03-08T00:00:00.000Z");

const DEGENERATE_SHAPES: { event: MaterializedSyncableEvent; instant: Date; name: string }[] = [
  {
    event: buildEvent({ endTime: INSTANT, startTime: INSTANT }),
    instant: INSTANT,
    name: "timed zero-duration",
  },
  {
    event: buildEvent({
      endTime: new Date(INSTANT.getTime() - 3_600_000),
      startTime: INSTANT,
    }),
    instant: INSTANT,
    name: "timed inverted",
  },
  {
    event: buildEvent({
      endTime: ALL_DAY_INSTANT,
      isAllDay: true,
      startTime: ALL_DAY_INSTANT,
    }),
    instant: ALL_DAY_INSTANT,
    name: "same-date all-day",
  },
  {
    event: buildEvent({
      endTime: new Date("2027-03-03T00:00:00.000Z"),
      isAllDay: true,
      startTime: ALL_DAY_INSTANT,
    }),
    instant: ALL_DAY_INSTANT,
    name: "inverted all-day",
  },
];

const FAR_PAST = new Date("2000-01-01T00:00:00.000Z");
const FAR_FUTURE = new Date("2100-01-01T00:00:00.000Z");

describe.each(HARNESS_FACTORIES)("$name destination at the window upper edge", ({ create }) => {
  it.each(DEGENERATE_SHAPES)(
    "mirrors a $name event one millisecond below the window upper edge and converges",
    async ({ event, instant }) => {
      const harness = create({
        events: [event],
        scope: createScope(FAR_PAST, new Date(instant.getTime() + 1)),
      });

      const first = await harness.runSync();
      const second = await harness.runSync();
      const third = await harness.runSync();

      expect(harness.pushFailures).toEqual([]);
      expect(first.added).toBe(1);
      expect(second).toMatchObject(QUIET);
      expect(third).toMatchObject(QUIET);
      expect(harness.remoteRanges()).toHaveLength(1);
      expect(harness.mappings).toHaveLength(1);
      expect(harness.totalDeletes()).toBe(0);
    },
  );

  it.each(DEGENERATE_SHAPES)(
    "leaves a $name event that starts exactly at the window upper edge unmirrored without churn",
    async ({ event, instant }) => {
      const harness = create({
        events: [event],
        scope: createScope(FAR_PAST, instant),
      });

      const first = await harness.runSync();
      const second = await harness.runSync();
      const third = await harness.runSync();

      expect(first).toMatchObject(QUIET);
      expect(second).toMatchObject(QUIET);
      expect(third).toMatchObject(QUIET);
      expect(harness.remoteRanges()).toEqual([]);
      expect(harness.mappings).toEqual([]);
    },
  );

  it.each(DEGENERATE_SHAPES)(
    "mirrors a $name event that starts exactly at the window lower edge and converges",
    async ({ event, instant }) => {
      const harness = create({
        events: [event],
        scope: createScope(instant, FAR_FUTURE),
      });

      const first = await harness.runSync();
      const second = await harness.runSync();
      const third = await harness.runSync();

      expect(harness.pushFailures).toEqual([]);
      expect(first.added).toBe(1);
      expect(second).toMatchObject(QUIET);
      expect(third).toMatchObject(QUIET);
      expect(harness.remoteRanges()).toHaveLength(1);
      expect(harness.totalDeletes()).toBe(0);
    },
  );
});

describe.each(HARNESS_FACTORIES)("$name destination as the window moves", ({ create }) => {
  it.each(DEGENERATE_SHAPES)(
    "retires a $name mirror exactly once when the window advances past it",
    async ({ event, instant }) => {
      const harness = create({
        events: [event],
        scope: createScope(instant, FAR_FUTURE),
      });

      const first = await harness.runSync();
      expect(first.added).toBe(1);

      harness.setScope(createScope(new Date(instant.getTime() + 1), FAR_FUTURE));

      const second = await harness.runSync();
      const third = await harness.runSync();
      const fourth = await harness.runSync();

      expect(second).toMatchObject({ added: 0, removed: 1 });
      expect(third).toMatchObject(QUIET);
      expect(fourth).toMatchObject(QUIET);
      expect(harness.remoteRanges()).toEqual([]);
      expect(harness.mappings).toEqual([]);
      expect(harness.totalDeletes()).toBe(1);
    },
  );

  it.each(DEGENERATE_SHAPES)(
    "re-mirrors a $name event exactly once when the window widens back over it",
    async ({ event, instant }) => {
      const harness = create({
        events: [event],
        scope: createScope(new Date(instant.getTime() + 1), FAR_FUTURE),
      });

      await harness.runSync();
      expect(harness.remoteRanges()).toEqual([]);

      harness.setScope(createScope(instant, FAR_FUTURE));

      const second = await harness.runSync();
      const third = await harness.runSync();
      const fourth = await harness.runSync();

      expect(second).toMatchObject({ added: 1, removed: 0 });
      expect(third).toMatchObject(QUIET);
      expect(fourth).toMatchObject(QUIET);
      expect(harness.remoteRanges()).toHaveLength(1);
    },
  );
});

describe.each(HARNESS_FACTORIES)("$name destination when the source range changes", ({ create }) => {
  it("settles after a degenerate range becomes a real range and back again", async () => {
    const degenerate = buildEvent({ endTime: INSTANT, startTime: INSTANT });
    const real = buildEvent({
      endTime: new Date(INSTANT.getTime() + 45 * 60_000),
      startTime: INSTANT,
    });
    const harness = create({ events: [degenerate] });

    expect(await harness.runSync()).toMatchObject({ added: 1 });
    expect(await harness.runSync()).toMatchObject(QUIET);

    harness.setEvents([real]);
    const afterWidening = await harness.runSync();
    expect(await harness.runSync()).toMatchObject(QUIET);
    expect(harness.remoteRanges()).toEqual([
      { end: new Date(INSTANT.getTime() + 45 * 60_000).toISOString(), start: INSTANT.toISOString() },
    ]);

    harness.setEvents([degenerate]);
    const afterNarrowing = await harness.runSync();
    expect(await harness.runSync()).toMatchObject(QUIET);
    expect(await harness.runSync()).toMatchObject(QUIET);

    expect(afterWidening.addFailed).toBe(0);
    expect(afterNarrowing.addFailed).toBe(0);
    expect(harness.remoteRanges()).toHaveLength(1);
    expect(harness.pushFailures).toEqual([]);
  });

  it("settles after an all-day range collapses onto a single date", async () => {
    const spanning = buildEvent({
      endTime: new Date("2027-03-11T00:00:00.000Z"),
      isAllDay: true,
      startTime: ALL_DAY_INSTANT,
    });
    const collapsed = buildEvent({
      endTime: ALL_DAY_INSTANT,
      isAllDay: true,
      startTime: ALL_DAY_INSTANT,
    });
    const harness = create({ events: [spanning] });

    expect(await harness.runSync()).toMatchObject({ added: 1 });
    harness.setEvents([collapsed]);
    await harness.runSync();

    expect(await harness.runSync()).toMatchObject(QUIET);
    expect(await harness.runSync()).toMatchObject(QUIET);
    expect(harness.pushFailures).toEqual([]);
    expect(harness.remoteRanges()).toHaveLength(1);
  });
});

describe.each(HARNESS_FACTORIES)("$name destination retrying a rejected push", ({ create }) => {
  it.each(DEGENERATE_SHAPES)(
    "retries a rejected $name push on the next run and then goes quiet",
    async ({ event }) => {
      const harness = create({ events: [event] });
      harness.setRejectPush(true);

      const first = await harness.runSync();
      expect(first).toMatchObject({ added: 0, addFailed: 1 });
      expect(harness.mappings).toEqual([]);

      harness.setRejectPush(false);
      const second = await harness.runSync();
      const third = await harness.runSync();
      const fourth = await harness.runSync();

      expect(second).toMatchObject({ added: 1, addFailed: 0 });
      expect(third).toMatchObject(QUIET);
      expect(fourth).toMatchObject(QUIET);
      expect(harness.remoteRanges()).toHaveLength(1);
    },
  );
});

describe.each(HARNESS_FACTORIES)("$name destination upgrading a legacy mirror", ({ create }) => {
  it("replaces a mapping recorded before normalization exactly once", async () => {
    const event = buildEvent({ endTime: INSTANT, startTime: INSTANT });
    const legacyMapping = {
      calendarId: DESTINATION_CALENDAR_ID,
      deleteIdentifier: "legacy-delete-id",
      destinationEventUid: "legacy-uid",
      endTime: INSTANT,
      eventStateId: event.eventStateId,
      id: "legacy-mapping",
      sourceCalendarId: SOURCE_CALENDAR_ID,
      startTime: INSTANT,
      syncEventHash: "hash-from-the-unnormalized-event",
      syncEventId: event.id,
    } as EventMapping;
    const harness = create({ events: [event], mappings: [legacyMapping] });

    const first = await harness.runSync();
    const second = await harness.runSync();
    const third = await harness.runSync();

    expect(first.added).toBe(1);
    expect(second).toMatchObject(QUIET);
    expect(third).toMatchObject(QUIET);
    expect(harness.mappings).toHaveLength(1);
    expect(harness.mappings[0]?.id).not.toBe("legacy-mapping");
    expect(harness.remoteRanges()).toHaveLength(1);
  });
});

const SUB_SECOND_SHAPES: { event: MaterializedSyncableEvent; name: string }[] = [
  {
    event: buildEvent({
      endTime: new Date("2027-03-08T16:00:00.500Z"),
      startTime: new Date("2027-03-08T16:00:00.500Z"),
    }),
    name: "half a second past the minute",
  },
  {
    event: buildEvent({
      endTime: new Date("2026-12-31T23:59:59.999Z"),
      startTime: new Date("2026-12-31T23:59:59.999Z"),
    }),
    name: "the last millisecond of a year",
  },
  {
    event: buildEvent({
      endTime: new Date("2028-02-29T23:59:30.000Z"),
      startTime: new Date("2028-02-29T23:59:30.000Z"),
    }),
    name: "a leap day whose widened minute lands in March",
  },
  {
    event: buildEvent({
      endTime: new Date("2027-03-14T06:59:30.000Z"),
      startTime: new Date("2027-03-14T06:59:30.000Z"),
      startTimeZone: "America/New_York",
    }),
    name: "a widened minute that steps over a spring-forward transition",
  },
  {
    event: buildEvent({
      endTime: new Date("2027-11-07T05:59:30.000Z"),
      startTime: new Date("2027-11-07T05:59:30.000Z"),
      startTimeZone: "America/New_York",
    }),
    name: "a widened minute that steps into a repeated fall-back hour",
  },
  {
    event: buildEvent({
      endTime: new Date("2027-03-08T16:00:00.000Z"),
      startTime: new Date("2027-03-08T16:00:00.000Z"),
      startTimeZone: "Australia/Lord_Howe",
    }),
    name: "a zone whose offset is not a whole number of hours",
  },
];

describe.each(HARNESS_FACTORIES)("$name destination at awkward instants", ({ create }) => {
  it.each(SUB_SECOND_SHAPES)(
    "mirrors a zero-duration event $name and converges",
    async ({ event }) => {
      const harness = create({ events: [event] });

      const first = await harness.runSync();
      const second = await harness.runSync();
      const third = await harness.runSync();

      expect(harness.pushFailures).toEqual([]);
      expect(first.added).toBe(1);
      expect(second).toMatchObject(QUIET);
      expect(third).toMatchObject(QUIET);
      expect(harness.remoteRanges()).toHaveLength(1);
      expect(harness.totalDeletes()).toBe(0);
      expect(harness.totalWrites()).toBe(1);
    },
  );
});
