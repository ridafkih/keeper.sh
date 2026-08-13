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

interface ReconciliationScopeShape {
  authoritativeSourceWindows?: ReadonlyMap<string, { timeMax: Date; timeMin: Date }>;
  authoritativeWindow: { timeMax: Date; timeMin: Date } | null;
  configuredSourceCalendarIds?: ReadonlySet<string>;
  requestedWindow: { timeMax: Date; timeMin: Date };
}

interface HarnessOptions {
  events: MaterializedSyncableEvent[];
  normalize?: boolean;
  scope?: ReconciliationScopeShape;
}

interface CalDAVHarness {
  deletes: number;
  setScope: (scope: ReconciliationScopeShape) => void;
  mappings: EventMapping[];
  nonConformantResources: string[];
  resources: Map<string, string>;
  setEvents: (events: MaterializedSyncableEvent[]) => void;
  setNormalize: (normalize: boolean) => void;
  writes: number;
  runSync: () => Promise<{
    added: number;
    addFailed: number;
    removed: number;
    removeFailed: number;
  }>;
}

const getEventIcsLine = (ics: string, name: string): string => {
  const lines = ics.split(/\r?\n/);
  const begin = lines.indexOf("BEGIN:VEVENT");
  const end = lines.indexOf("END:VEVENT");
  if (begin === -1 || end === -1) {
    return "";
  }
  return lines.slice(begin, end).find((line) => line.startsWith(name)) ?? "";
};

const getIcsLine = (ics: string, name: string): string => getEventIcsLine(ics, name);

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
  const state = {
    events: options.events,
    normalize: options.normalize ?? true,
    scope: options.scope ?? WIDE_SCOPE,
  };

  const listRemoteEvents = (listOptions: { timeMin: Date }): Promise<RemoteEvent[]> => {
    const parsed = parseICalCalendarsToRemoteEvents([...resources.values()], {
      rejectUnsupportedRecurrenceDates: false,
    });
    return Promise.resolve(parsed.events.flatMap((event): RemoteEvent[] => {
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
    }));
  };

  const provider: CalendarSyncProvider = {
    deleteEvents: (eventIds) => {
      counters.deletes += eventIds.length;
      for (const eventId of eventIds) {
        resources.delete(eventId);
      }
      return Promise.resolve(eventIds.map(() => ({ success: true })));
    },
    listRemoteEvents,
    normalizeEvent: (event) => {
      if (!state.normalize) {
        return event;
      }
      return normalizeCalDAVEvent(event);
    },
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
    setEvents: (events: MaterializedSyncableEvent[]) => {
      state.events = events;
    },
    setNormalize: (normalize: boolean) => {
      state.normalize = normalize;
    },
    setScope: (scope: ReconciliationScopeShape) => {
      state.scope = scope;
    },
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
      readState: async () => ({
        existingMappings: [...mappings],
        localEvents: state.events,
        remoteEvents: await listRemoteEvents({ timeMin: state.scope.requestedWindow.timeMin }),
      }),
      reconciliationScope: state.scope,
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

const readInstants = (ics: string): { end: string; start: string } => ({
  end: getIcsLine(ics, "DTEND"),
  start: getIcsLine(ics, "DTSTART"),
});

const cases: { event: MaterializedSyncableEvent; name: string }[] = [
  {
    event: buildEvent({
      endTime: new Date("2027-10-31T01:30:00.000Z"),
      startTime: new Date("2027-10-31T01:30:00.000Z"),
      startTimeZone: "Europe/London",
    }),
    name: "zero-duration event in the second pass of a fall-back hour",
  },
  {
    event: buildEvent({
      endTime: new Date("2027-10-31T00:30:00.000Z"),
      startTime: new Date("2027-10-31T00:30:00.000Z"),
      startTimeZone: "Europe/London",
    }),
    name: "zero-duration event in the first pass of a fall-back hour",
  },
  {
    event: buildEvent({
      endTime: new Date("2027-10-31T00:59:30.000Z"),
      startTime: new Date("2027-10-31T00:59:30.000Z"),
      startTimeZone: "Europe/London",
    }),
    name: "zero-duration event whose widened minute crosses a fall-back transition",
  },
  {
    event: buildEvent({
      endTime: new Date("2027-03-28T00:59:30.000Z"),
      startTime: new Date("2027-03-28T00:59:30.000Z"),
      startTimeZone: "Europe/London",
    }),
    name: "zero-duration event whose widened minute crosses a spring-forward transition",
  },
  {
    event: buildEvent({
      endTime: new Date("2027-03-14T07:00:00.000Z"),
      startTime: new Date("2027-03-14T07:00:00.000Z"),
      startTimeZone: "America/New_York",
    }),
    name: "zero-duration event exactly on a spring-forward transition instant",
  },
  {
    event: buildEvent({
      endTime: new Date("2027-06-01T09:15:00.000Z"),
      startTime: new Date("2027-06-01T10:15:00.000Z"),
      startTimeZone: "Asia/Kathmandu",
    }),
    name: "inverted event in a quarter-hour offset zone",
  },
  {
    event: buildEvent({
      endTime: new Date("2027-10-03T15:45:00.000Z"),
      startTime: new Date("2027-10-03T15:45:00.000Z"),
      startTimeZone: "Australia/Lord_Howe",
    }),
    name: "zero-duration event in a half-hour daylight zone",
  },
  {
    event: buildEvent({
      endTime: new Date("2027-06-01T17:00:00.000Z"),
      startTime: new Date("2027-06-01T17:00:00.000Z"),
      startTimeZone: "Pacific Standard Time",
    }),
    name: "zero-duration event carrying a windows timezone identifier",
  },
  {
    event: buildEvent({
      endTime: new Date("2027-09-05T00:00:00.000Z"),
      isAllDay: true,
      startTime: new Date("2027-09-05T00:00:00.000Z"),
      startTimeZone: "America/Santiago",
    } as Partial<MaterializedSyncableEvent>),
    name: "same-date all-day event on a day whose local midnight does not exist",
  },
];

describe("caldav convergence for degenerate ranges in awkward zones", () => {
  for (const testCase of cases) {
    it(`mirrors a ${testCase.name} once and never rewrites it`, async () => {
      const harness = createCalDAVHarness({ events: [testCase.event] });
      const runs = await runThreeTimes(harness);

      expect(runs.first.added).toBe(1);
      expect(runs.second).toMatchObject({ added: 0, addFailed: 0, removed: 0, removeFailed: 0 });
      expect(runs.third).toMatchObject({ added: 0, addFailed: 0, removed: 0, removeFailed: 0 });
      expect(harness.writes).toBe(1);
      expect(harness.deletes).toBe(0);
      expect(harness.resources.size).toBe(1);
      expect(harness.mappings).toHaveLength(1);
      expect(harness.nonConformantResources).toEqual([]);
    });

    it(`reads back the instants it wrote for a ${testCase.name}`, async () => {
      const harness = createCalDAVHarness({ events: [testCase.event] });
      await harness.runSync();

      const [ics] = [...harness.resources.values()];
      expect(ics).toBeDefined();
      const parsed = parseICalCalendarsToRemoteEvents([ics ?? ""], {
        rejectUnsupportedRecurrenceDates: false,
      });
      const [readBack] = parsed.events;
      const [mapping] = harness.mappings;
      expect(readBack).toBeDefined();
      expect(mapping).toBeDefined();
      expect(readBack?.startTime.toISOString()).toBe(mapping?.startTime.toISOString());
      expect(readBack?.endTime.toISOString()).toBe(mapping?.endTime.toISOString());
      expect(readBack?.endTime.getTime()).toBeGreaterThan(readBack?.startTime.getTime() ?? 0);
    });
  }
});

describe("upgrading a destination written before normalization", () => {
  it("repairs an inverted mirror exactly once and then leaves it alone", async () => {
    const event = buildEvent({
      endTime: new Date("2027-03-08T15:00:00.000Z"),
      startTime: new Date("2027-03-08T16:00:00.000Z"),
      startTimeZone: "America/New_York",
    });
    const harness = createCalDAVHarness({ events: [event], normalize: false });

    await harness.runSync();
    const legacyResource = [...harness.resources.values()][0] ?? "";
    expect(isNonConformantResource(legacyResource)).toBe(true);
    const legacyWrites = harness.writes;

    harness.setNormalize(true);
    const repair = await harness.runSync();
    const writesAfterRepair = harness.writes;
    const deletesAfterRepair = harness.deletes;

    const settled = await runThreeTimes(harness);

    expect(legacyWrites).toBe(1);
    expect(repair.addFailed).toBe(0);
    expect(writesAfterRepair).toBe(2);
    expect(harness.writes).toBe(writesAfterRepair);
    expect(harness.deletes).toBe(deletesAfterRepair);
    expect(settled.first).toMatchObject({ added: 0, addFailed: 0, removed: 0, removeFailed: 0 });
    expect(settled.third).toMatchObject({ added: 0, addFailed: 0, removed: 0, removeFailed: 0 });
    expect(harness.mappings).toHaveLength(1);
    expect(harness.resources.size).toBe(1);
    expect(isNonConformantResource([...harness.resources.values()][0] ?? "")).toBe(false);
  });

  it("does not rewrite the mirror when a source event flips between zero duration and the widened span", async () => {
    const zeroDuration = buildEvent({
      endTime: new Date("2027-03-08T16:00:00.000Z"),
      startTime: new Date("2027-03-08T16:00:00.000Z"),
      startTimeZone: "America/New_York",
    });
    const widened = buildEvent({
      endTime: new Date("2027-03-08T16:01:00.000Z"),
      startTime: new Date("2027-03-08T16:00:00.000Z"),
      startTimeZone: "America/New_York",
    });
    const harness = createCalDAVHarness({ events: [zeroDuration] });

    await harness.runSync();
    harness.setEvents([widened]);
    const afterWiden = await harness.runSync();
    harness.setEvents([zeroDuration]);
    const afterCollapse = await harness.runSync();

    expect(afterWiden).toMatchObject({ added: 0, addFailed: 0, removed: 0, removeFailed: 0 });
    expect(afterCollapse).toMatchObject({ added: 0, addFailed: 0, removed: 0, removeFailed: 0 });
    expect(harness.writes).toBe(1);
    expect(harness.deletes).toBe(0);
    expect(harness.mappings).toHaveLength(1);
  });
});

describe("degenerate ranges the destination reports back differently", () => {
  it("settles when the source moves a zero-duration event across a fall-back fold", async () => {
    const firstPass = buildEvent({
      endTime: new Date("2027-10-31T00:30:00.000Z"),
      startTime: new Date("2027-10-31T00:30:00.000Z"),
      startTimeZone: "Europe/London",
    });
    const secondPass = buildEvent({
      endTime: new Date("2027-10-31T01:30:00.000Z"),
      startTime: new Date("2027-10-31T01:30:00.000Z"),
      startTimeZone: "Europe/London",
    });
    const harness = createCalDAVHarness({ events: [firstPass] });

    await harness.runSync();
    const firstIcs = readInstants([...harness.resources.values()][0] ?? "");
    harness.setEvents([secondPass]);
    await harness.runSync();
    const movedIcs = readInstants([...harness.resources.values()][0] ?? "");
    const settled = await runThreeTimes(harness);

    expect(firstIcs.start).not.toBe(movedIcs.start);
    expect(settled.first).toMatchObject({ added: 0, addFailed: 0, removed: 0, removeFailed: 0 });
    expect(settled.second).toMatchObject({ added: 0, addFailed: 0, removed: 0, removeFailed: 0 });
    expect(settled.third).toMatchObject({ added: 0, addFailed: 0, removed: 0, removeFailed: 0 });
    expect(harness.mappings).toHaveLength(1);
    expect(harness.resources.size).toBe(1);
  });
});

const NARROW_SCOPE: ReconciliationScopeShape = {
  authoritativeWindow: {
    timeMax: new Date("2027-03-09T00:00:00.000Z"),
    timeMin: new Date("2027-03-08T00:00:00.000Z"),
  },
  requestedWindow: {
    timeMax: new Date("2027-03-09T00:00:00.000Z"),
    timeMin: new Date("2027-03-08T00:00:00.000Z"),
  },
};

const PARTIALLY_VERIFIED_SCOPE: ReconciliationScopeShape = {
  authoritativeSourceWindows: new Map([
    ["source-calendar", {
      timeMax: new Date("2027-03-09T00:00:00.000Z"),
      timeMin: new Date("2027-03-08T06:00:00.000Z"),
    }],
  ]),
  authoritativeWindow: {
    timeMax: new Date("2027-03-09T00:00:00.000Z"),
    timeMin: new Date("2027-03-08T06:00:00.000Z"),
  },
  configuredSourceCalendarIds: new Set(["source-calendar"]),
  requestedWindow: {
    timeMax: new Date("2027-03-09T00:00:00.000Z"),
    timeMin: new Date("2027-03-08T00:00:00.000Z"),
  },
};

const FULLY_VERIFIED_SCOPE: ReconciliationScopeShape = {
  authoritativeSourceWindows: new Map([
    ["source-calendar", {
      timeMax: new Date("2027-03-09T00:00:00.000Z"),
      timeMin: new Date("2027-03-08T00:00:00.000Z"),
    }],
  ]),
  authoritativeWindow: {
    timeMax: new Date("2027-03-09T00:00:00.000Z"),
    timeMin: new Date("2027-03-08T00:00:00.000Z"),
  },
  configuredSourceCalendarIds: new Set(["source-calendar"]),
  requestedWindow: {
    timeMax: new Date("2027-03-09T00:00:00.000Z"),
    timeMin: new Date("2027-03-08T00:00:00.000Z"),
  },
};

describe("a degenerate event outside its source's verified coverage", () => {
  const unverified = {
    endTime: new Date("2027-03-08T03:00:00.000Z"),
    startTime: new Date("2027-03-08T03:00:00.000Z"),
  };

  it("does not oscillate between adding and retiring a zero-duration event", async () => {
    const harness = createCalDAVHarness({
      events: [buildEvent(unverified)],
      scope: PARTIALLY_VERIFIED_SCOPE,
    });

    const runs = [
      await harness.runSync(),
      await harness.runSync(),
      await harness.runSync(),
      await harness.runSync(),
    ];

    const churned = runs.slice(1).some((run) => run.added > 0 || run.removed > 0);
    expect(churned).toBe(false);
    expect(harness.writes).toBeLessThanOrEqual(1);
    expect(harness.deletes).toBe(0);
  });

  it("mirrors the zero-duration event once the source verifies the rest of the window", async () => {
    const harness = createCalDAVHarness({
      events: [buildEvent(unverified)],
      scope: PARTIALLY_VERIFIED_SCOPE,
    });

    await harness.runSync();
    harness.setScope(FULLY_VERIFIED_SCOPE);
    const verified = await harness.runSync();
    const settled = await runThreeTimes(harness);

    expect(verified.added).toBe(1);
    expect(settled.first).toMatchObject({ added: 0, addFailed: 0, removed: 0, removeFailed: 0 });
    expect(settled.third).toMatchObject({ added: 0, addFailed: 0, removed: 0, removeFailed: 0 });
    expect(harness.writes).toBe(1);
    expect(harness.deletes).toBe(0);
    expect(harness.mappings).toHaveLength(1);
  });
});

describe("a window that moves between runs", () => {
  it("retires a zero-duration mirror once when the window shrinks past it and restores it once", async () => {
    const event = buildEvent({
      endTime: new Date("2027-03-08T12:00:00.000Z"),
      startTime: new Date("2027-03-08T12:00:00.000Z"),
    });
    const harness = createCalDAVHarness({ events: [event], scope: NARROW_SCOPE });

    const initial = await harness.runSync();
    harness.setScope({
      authoritativeWindow: {
        timeMax: new Date("2027-03-20T00:00:00.000Z"),
        timeMin: new Date("2027-03-10T00:00:00.000Z"),
      },
      requestedWindow: {
        timeMax: new Date("2027-03-20T00:00:00.000Z"),
        timeMin: new Date("2027-03-10T00:00:00.000Z"),
      },
    });
    const shrunk = await harness.runSync();
    const shrunkAgain = await harness.runSync();
    harness.setScope(NARROW_SCOPE);
    const restored = await harness.runSync();
    const settled = await harness.runSync();

    expect(initial.added).toBe(1);
    expect(shrunk.removed).toBe(1);
    expect(shrunkAgain).toMatchObject({ added: 0, addFailed: 0, removed: 0, removeFailed: 0 });
    expect(restored.added).toBe(1);
    expect(settled).toMatchObject({ added: 0, addFailed: 0, removed: 0, removeFailed: 0 });
    expect(harness.mappings).toHaveLength(1);
    expect(harness.resources.size).toBe(1);
  });

  it("retires a zero-duration mirror once when the source drops every event", async () => {
    const harness = createCalDAVHarness({
      events: [buildEvent({
        endTime: new Date("2027-03-08T12:00:00.000Z"),
        startTime: new Date("2027-03-08T12:00:00.000Z"),
      })],
      scope: NARROW_SCOPE,
    });

    await harness.runSync();
    harness.setEvents([]);
    const dropped = await harness.runSync();
    const settled = await runThreeTimes(harness);

    expect(dropped.removed).toBe(1);
    expect(settled.first).toMatchObject({ added: 0, addFailed: 0, removed: 0, removeFailed: 0 });
    expect(settled.third).toMatchObject({ added: 0, addFailed: 0, removed: 0, removeFailed: 0 });
    expect(harness.deletes).toBe(1);
    expect(harness.mappings).toHaveLength(0);
    expect(harness.resources.size).toBe(0);
  });
});
