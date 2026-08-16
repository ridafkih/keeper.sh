import { describe, expect, it } from "vitest";
import type { GoogleEvent } from "@keeper.sh/data-schemas";
import { syncCalendar } from "../../../src/core/sync-engine/index";
import type { CalendarSyncProvider, PendingChanges } from "../../../src/core/sync-engine/types";
import type {
  EventMapping,
  MaterializedSyncableEvent,
  RemoteEvent,
  RemoteEventListing,
  SyncableEvent,
} from "../../../src/index";
import { createEditableEventContentHash } from "../../../src/core/events/content-hash";
import { generateDeterministicEventUid } from "../../../src/core/events/identity";
import { isEventInDestinationReconciliationWindow } from "../../../src/core/events/events";
import { materializeRecurrenceEvents } from "../../../src/core/events/recurrence-materializer";
import { normalizeCalDAVEvent } from "../../../src/providers/caldav/destination/normalize-event";
import { normalizeGoogleEvent } from "../../../src/providers/google/destination/normalize-event";
import { serializeGoogleEvent } from "../../../src/providers/google/destination/serialize-event";
import { parseEventTime as parseGoogleEventTime } from "../../../src/providers/google/shared/date-time";
import {
  eventToICalString,
  parseICalCalendarsToRemoteEvents,
} from "../../../src/providers/caldav/shared/ics";

const SOURCE_CALENDAR_ID = "source-calendar";
const DESTINATION_CALENDAR_ID = "destination-calendar";
const MS_PER_MINUTE = 60_000;

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

const DEFAULT_SCOPE = createScope(
  new Date("2027-03-08T00:00:00.000Z"),
  new Date("2027-03-13T00:00:00.000Z"),
);

const buildMaster = (overrides: Partial<SyncableEvent>): SyncableEvent => ({
  availability: "busy",
  calendarId: SOURCE_CALENDAR_ID,
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2027-03-08T09:00:00.000Z"),
  eventStateId: "series-state",
  id: "series-state",
  recurrenceRule: { frequency: "DAILY" },
  sourceEventUid: "series-uid",
  startTime: new Date("2027-03-08T09:00:00.000Z"),
  summary: "Standup marker",
  ...overrides,
} as SyncableEvent);

const materialize = (
  events: SyncableEvent[],
  scope: ScopeShape,
): MaterializedSyncableEvent[] => materializeRecurrenceEvents(events, {
  end: scope.requestedWindow.timeMax,
  start: scope.requestedWindow.timeMin,
});

interface RunResult {
  added: number;
  addFailed: number;
  removed: number;
  removeFailed: number;
}

interface Harness {
  mappings: EventMapping[];
  remoteRanges: () => string[];
  runSync: () => Promise<RunResult>;
  setSource: (events: SyncableEvent[]) => void;
  setScope: (scope: ScopeShape) => void;
  totalDeletes: () => number;
  totalWrites: () => number;
}

interface HarnessOptions {
  scope?: ScopeShape;
  source: SyncableEvent[];
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
      id: `mapping-${crypto.randomUUID()}`,
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

const describeRange = (startTime: Date, endTime: Date): string =>
  `${startTime.toISOString()}/${endTime.toISOString()}`;

const createSharedState = (options: HarnessOptions) => ({
  counters: { deletes: 0, writes: 0 },
  scope: options.scope ?? DEFAULT_SCOPE,
  source: options.source,
});

const readLocalEvents = (
  source: SyncableEvent[],
  scope: ScopeShape,
): MaterializedSyncableEvent[] => materialize(source, scope).filter((event) =>
  isEventInDestinationReconciliationWindow(event, scope.requestedWindow.timeMin));

const createGoogleHarness = (options: HarnessOptions): Harness => {
  const mappings: EventMapping[] = [];
  const stored = new Map<string, GoogleEvent & { id: string }>();
  const state = createSharedState(options);
  let nextRemoteId = 0;

  const readRange = (event: GoogleEvent): { endTime: Date; startTime: Date } | null => {
    const startTime = parseGoogleEventTime(event.start);
    const endTime = parseGoogleEventTime(event.end);
    if (!startTime || !endTime) {
      return null;
    }
    return { endTime, startTime };
  };

  const listRemoteEvents = (listOptions: { timeMin: Date }): Promise<RemoteEventListing> => {
    const items = [...stored.values()].flatMap((event): RemoteEvent[] => {
      const range = readRange(event);
      if (!range || range.endTime < listOptions.timeMin) {
        return [];
      }
      const availability = toAvailability(event.transparency === "transparent");
      return [{
        deleteId: event.id,
        editableAvailability: availability,
        editableContentHash: createEditableEventContentHash({
          availability,
          description: event.description,
          endTime: range.endTime,
          isAllDay: Boolean(event.start?.date),
          location: event.location,
          startTime: range.startTime,
          summary: event.summary ?? "",
        }),
        endTime: range.endTime,
        isKeeperEvent: true,
        startTime: range.startTime,
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
      const uid = `keeper-${event.id}`;
      const payload = serializeGoogleEvent(event, uid);
      if (!payload) {
        return { error: "not serializable", success: false as const };
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
    remoteRanges: () => [...stored.values()].flatMap((event) => {
      const range = readRange(event);
      if (!range) {
        return [];
      }
      return [describeRange(range.startTime, range.endTime)];
    }).toSorted(),
    runSync: () => syncCalendar({
      calendarId: DESTINATION_CALENDAR_ID,
      flush: (changes: PendingChanges) => {
        applyChanges(mappings, changes);
        return Promise.resolve();
      },
      isCurrent: () => Promise.resolve(true),
      provider,
      readState: async () => {
        const listing = await listRemoteEvents({ timeMin: state.scope.requestedWindow.timeMin });
        return {
          existingMappings: [...mappings],
          localEvents: readLocalEvents(state.source, state.scope),
          remoteEvents: listing.items,
          remoteRawItemCount: listing.rawItemCount,
        };
      },
      reconciliationScope: state.scope,
      userId: "user-1",
    }),
    setScope: (scope) => {
      state.scope = scope;
    },
    setSource: (source) => {
      state.source = source;
    },
    totalDeletes: () => state.counters.deletes,
    totalWrites: () => state.counters.writes,
  };
};

const createCalDAVHarness = (options: HarnessOptions): Harness => {
  const mappings: EventMapping[] = [];
  const resources = new Map<string, string>();
  const state = createSharedState(options);

  const readResources = () => parseICalCalendarsToRemoteEvents([...resources.values()], {
    rejectUnsupportedRecurrenceDates: false,
  }).events;

  const listRemoteEvents = (listOptions: { timeMin: Date }): Promise<RemoteEventListing> => {
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
      const uid = generateDeterministicEventUid(event.id);
      state.counters.writes += 1;
      resources.set(uid, eventToICalString(event, uid));
      return { deleteId: uid, remoteId: uid, success: true as const };
    })),
  };

  return {
    mappings,
    remoteRanges: () => readResources()
      .map((event) => describeRange(event.startTime, event.endTime))
      .toSorted(),
    runSync: () => syncCalendar({
      calendarId: DESTINATION_CALENDAR_ID,
      flush: (changes: PendingChanges) => {
        applyChanges(mappings, changes);
        return Promise.resolve();
      },
      isCurrent: () => Promise.resolve(true),
      provider,
      readState: async () => {
        const listing = await listRemoteEvents({ timeMin: state.scope.requestedWindow.timeMin });
        return {
          existingMappings: [...mappings],
          localEvents: readLocalEvents(state.source, state.scope),
          remoteEvents: listing.items,
          remoteRawItemCount: listing.rawItemCount,
        };
      },
      reconciliationScope: state.scope,
      userId: "user-1",
    }),
    setScope: (scope) => {
      state.scope = scope;
    },
    setSource: (source) => {
      state.source = source;
    },
    totalDeletes: () => state.counters.deletes,
    totalWrites: () => state.counters.writes,
  };
};

const HARNESS_FACTORIES: { create: (options: HarnessOptions) => Harness; name: string }[] = [
  { create: createGoogleHarness, name: "google" },
  { create: createCalDAVHarness, name: "caldav" },
];

const QUIET: RunResult = { added: 0, addFailed: 0, removed: 0, removeFailed: 0 };

const ZERO_DURATION_MASTER = buildMaster({});

describe.each(HARNESS_FACTORIES)("$name mirror of a reshaped degenerate series", ({ create }) => {
  it("does not touch the destination when the source gives every occurrence the duration it was already mirrored with", async () => {
    const harness = create({ source: [ZERO_DURATION_MASTER] });

    const first = await harness.runSync();
    expect(first.added).toBe(5);
    const rangesBefore = harness.remoteRanges();
    const writesBefore = harness.totalWrites();

    harness.setSource([buildMaster({
      endTime: new Date(ZERO_DURATION_MASTER.startTime.getTime() + MS_PER_MINUTE),
    })]);

    const second = await harness.runSync();
    const third = await harness.runSync();

    expect(second).toMatchObject({ addFailed: 0, removeFailed: 0 });
    expect(third).toMatchObject(QUIET);
    expect(harness.remoteRanges()).toEqual(rangesBefore);
    expect(harness.totalDeletes()).toBe(0);
    expect(harness.totalWrites()).toBe(writesBefore);
    expect(harness.mappings).toHaveLength(5);
  });

  it("settles in one run when a zero-duration series grows a real duration", async () => {
    const harness = create({ source: [ZERO_DURATION_MASTER] });

    const seeded = await harness.runSync();
    expect(seeded.added).toBe(5);

    harness.setSource([buildMaster({
      endTime: new Date(ZERO_DURATION_MASTER.startTime.getTime() + 30 * MS_PER_MINUTE),
    })]);

    await harness.runSync();
    const third = await harness.runSync();
    const fourth = await harness.runSync();

    expect(third).toMatchObject(QUIET);
    expect(fourth).toMatchObject(QUIET);
    expect(harness.mappings).toHaveLength(5);
    expect(harness.remoteRanges()).toEqual([
      "2027-03-08T09:00:00.000Z/2027-03-08T09:30:00.000Z",
      "2027-03-09T09:00:00.000Z/2027-03-09T09:30:00.000Z",
      "2027-03-10T09:00:00.000Z/2027-03-10T09:30:00.000Z",
      "2027-03-11T09:00:00.000Z/2027-03-11T09:30:00.000Z",
      "2027-03-12T09:00:00.000Z/2027-03-12T09:30:00.000Z",
    ]);
  });

  it("settles in one run when an inverted series is corrected to a zero-duration one", async () => {
    const inverted = buildMaster({
      endTime: new Date("2027-03-08T08:00:00.000Z"),
    });
    const harness = create({ source: [inverted] });

    const seeded = await harness.runSync();
    expect(seeded.added).toBe(5);
    const rangesBefore = harness.remoteRanges();

    harness.setSource([ZERO_DURATION_MASTER]);

    await harness.runSync();
    const third = await harness.runSync();
    const fourth = await harness.runSync();

    expect(third).toMatchObject(QUIET);
    expect(fourth).toMatchObject(QUIET);
    expect(harness.remoteRanges()).toEqual(rangesBefore);
    expect(harness.mappings).toHaveLength(5);
  });

  it("retires exactly one mirror when an occurrence is excepted", async () => {
    const harness = create({ source: [ZERO_DURATION_MASTER] });

    const seeded = await harness.runSync();
    expect(seeded.added).toBe(5);

    harness.setSource([buildMaster({
      exceptionDates: [new Date("2027-03-10T09:00:00.000Z")],
    })]);

    const second = await harness.runSync();
    const third = await harness.runSync();

    expect(second).toMatchObject({ added: 0, removed: 1 });
    expect(third).toMatchObject(QUIET);
    expect(harness.mappings).toHaveLength(4);
    expect(harness.remoteRanges()).not.toContain(
      "2027-03-10T09:00:00.000Z/2027-03-10T09:01:00.000Z",
    );
  });

  it("keeps a rolling window's mirror set converged as the window advances a day at a time", async () => {
    const harness = create({ source: [ZERO_DURATION_MASTER] });

    const seeded = await harness.runSync();
    expect(seeded.added).toBe(5);
    expect(await harness.runSync()).toMatchObject(QUIET);

    harness.setScope(createScope(
      new Date("2027-03-09T00:00:00.000Z"),
      new Date("2027-03-14T00:00:00.000Z"),
    ));

    const shifted = await harness.runSync();
    const settled = await harness.runSync();

    expect(shifted).toMatchObject({ added: 1, removed: 1 });
    expect(settled).toMatchObject(QUIET);
    expect(harness.mappings).toHaveLength(5);

    harness.setScope(createScope(
      new Date("2027-03-10T00:00:00.000Z"),
      new Date("2027-03-15T00:00:00.000Z"),
    ));

    const shiftedAgain = await harness.runSync();
    expect(shiftedAgain).toMatchObject({ added: 1, removed: 1 });
    expect(await harness.runSync()).toMatchObject(QUIET);
    expect(await harness.runSync()).toMatchObject(QUIET);
    expect(harness.mappings).toHaveLength(5);
  });
});

describe.each(HARNESS_FACTORIES)("$name mirror of colliding degenerate events", ({ create }) => {
  it("keeps two distinct sources that name the same instant apart across runs", async () => {
    const instant = new Date("2027-03-09T12:00:00.000Z");
    const first = buildMaster({
      endTime: instant,
      eventStateId: "state-a",
      id: "state-a",
      recurrenceRule: globalThis.undefined,
      sourceEventUid: "uid-a",
      startTime: instant,
      summary: "Marker A",
    });
    const second = buildMaster({
      endTime: instant,
      eventStateId: "state-b",
      id: "state-b",
      recurrenceRule: globalThis.undefined,
      sourceEventUid: "uid-b",
      startTime: instant,
      summary: "Marker B",
    });
    const harness = create({ source: [first, second] });

    const seeded = await harness.runSync();
    expect(seeded.added).toBe(2);
    expect(await harness.runSync()).toMatchObject(QUIET);
    expect(await harness.runSync()).toMatchObject(QUIET);
    expect(harness.mappings).toHaveLength(2);
    expect(harness.totalDeletes()).toBe(0);
    expect(new Set(harness.mappings.map((mapping) => mapping.syncEventId)))
      .toEqual(new Set(["state-a", "state-b"]));
  });

  it("retires only the mirror of the source that disappears", async () => {
    const instant = new Date("2027-03-09T12:00:00.000Z");
    const survivor = buildMaster({
      endTime: instant,
      eventStateId: "state-a",
      id: "state-a",
      recurrenceRule: globalThis.undefined,
      sourceEventUid: "uid-a",
      startTime: instant,
      summary: "Marker A",
    });
    const doomed = buildMaster({
      endTime: instant,
      eventStateId: "state-b",
      id: "state-b",
      recurrenceRule: globalThis.undefined,
      sourceEventUid: "uid-b",
      startTime: instant,
      summary: "Marker B",
    });
    const harness = create({ source: [survivor, doomed] });

    await harness.runSync();
    harness.setSource([survivor]);

    const second = await harness.runSync();
    const third = await harness.runSync();

    expect(second).toMatchObject({ added: 0, removed: 1 });
    expect(third).toMatchObject(QUIET);
    expect(harness.mappings).toHaveLength(1);
    expect(harness.mappings[0]?.syncEventId).toBe("state-a");
  });
});
