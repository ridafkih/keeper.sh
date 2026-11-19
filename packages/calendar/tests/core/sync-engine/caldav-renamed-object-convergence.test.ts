import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { syncCalendar } from "../../../src/core/sync-engine/index";
import type { PendingChanges } from "../../../src/core/sync-engine/types";
import type { EventMapping, MaterializedSyncableEvent } from "../../../src/index";
import { generateDeterministicEventUid } from "../../../src/core/events/identity";
import { createCalDAVSyncProvider } from "../../../src/providers/caldav/destination/provider";
import { eventToICalString } from "../../../src/providers/caldav/shared/ics";
import {
  createRenamingCalDAVServer,
  RENAMING_CALENDAR_PATH,
  RENAMING_CALENDAR_URL,
} from "../../providers/caldav/shared/fake-renaming-caldav";
import type { RenamingCalDAVServer } from "../../providers/caldav/shared/fake-renaming-caldav";

const DESTINATION_CALENDAR_ID = "destination-calendar";

const SCOPE = {
  authoritativeWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
  requestedWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
};

const buildEvent = (overrides: Partial<MaterializedSyncableEvent> = {}): MaterializedSyncableEvent => ({
  availability: "busy",
  calendarId: "source-calendar",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2027-03-08T17:00:00.000Z"),
  eventStateId: "event-state-1",
  id: "event-state-1",
  sourceEventUid: "source-uid",
  startTime: new Date("2027-03-08T16:00:00.000Z"),
  startTimeZone: "UTC",
  summary: "Planning",
  ...overrides,
} as MaterializedSyncableEvent);

const OWNERS_EVENT = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:040000008200E00074C5B7101A82E008",
  "DTSTART:20270309T090000Z",
  "DTEND:20270309T100000Z",
  "SUMMARY:Dentist",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const OWNERS_UNREADABLE_EVENT = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "UID:040000008200E00074C5B7101A82E009",
  "DTSTART:not-a-date",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

interface Harness {
  events: MaterializedSyncableEvent[];
  mappings: EventMapping[];
  runSync: () => ReturnType<typeof syncCalendar>;
}

const applyChanges = (mappings: EventMapping[], changes: PendingChanges): void => {
  for (const insert of changes.inserts) {
    mappings.push({ ...insert, id: `mapping-${insert.syncEventId}-${mappings.length}` } as EventMapping);
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
      Object.assign(mapping, update);
    }
  }
};

const createHarness = (events: MaterializedSyncableEvent[]): Harness => {
  const mappings: EventMapping[] = [];
  const harness: Harness = {
    events,
    mappings,
    runSync: () => {
      const provider = createCalDAVSyncProvider({
        authMethod: "basic",
        calendarUrl: RENAMING_CALENDAR_URL,
        password: "password",
        serverUrl: RENAMING_CALENDAR_URL,
        username: "someone",
      });
      return syncCalendar({
        calendarId: DESTINATION_CALENDAR_ID,
        flush: (changes) => {
          applyChanges(mappings, changes);
          return Promise.resolve();
        },
        isCurrent: () => Promise.resolve(true),
        provider,
        readState: async () => ({
          existingMappings: mappings.map((mapping) => ({ ...mapping })),
          localEvents: harness.events,
          remoteEvents: await provider.listRemoteEvents(SCOPE.requestedWindow),
        }),
        reconciliationScope: SCOPE,
        userId: "user-1",
      });
    },
  };
  return harness;
};

let originalFetch: typeof globalThis.fetch = globalThis.fetch;
let server: RenamingCalDAVServer = createRenamingCalDAVServer();

beforeEach(() => {
  originalFetch = globalThis.fetch;
  server = createRenamingCalDAVServer();
  globalThis.fetch = server.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("a CalDAV destination that renames the objects it stores", () => {
  it("mirrors an event once and leaves it alone on later runs", async () => {
    const harness = createHarness([buildEvent()]);

    const first = await harness.runSync();
    const second = await harness.runSync();
    const third = await harness.runSync();

    expect(first).toMatchObject({ addFailed: 0, added: 1, removeFailed: 0, removed: 0 });
    expect(second).toMatchObject({ addFailed: 0, added: 0, removeFailed: 0, removed: 0 });
    expect(third).toMatchObject({ addFailed: 0, added: 0, removeFailed: 0, removed: 0 });
    expect(server.names()).toHaveLength(1);
    expect(server.writes).toHaveLength(1);
  });

  it("records the href the server lists for the mirror", async () => {
    const harness = createHarness([buildEvent()]);

    await harness.runSync();
    await harness.runSync();

    const [name] = server.names();
    expect(harness.mappings.map((mapping) => mapping.deleteIdentifier))
      .toEqual([`${RENAMING_CALENDAR_PATH}${encodeURIComponent(name ?? "")}`]);
  });

  it("rewrites the mirror in place when the source event changes", async () => {
    const harness = createHarness([buildEvent()]);
    await harness.runSync();
    await harness.runSync();
    const [name] = server.names();

    harness.events = [buildEvent({ summary: "Planning, moved" })];
    const changed = await harness.runSync();
    const settled = await harness.runSync();

    expect(changed).toMatchObject({ addFailed: 0, removeFailed: 0 });
    expect(settled).toMatchObject({ addFailed: 0, added: 0, removeFailed: 0, removed: 0 });
    expect(server.names()).toEqual([name]);
    expect(server.read(name ?? "")).toContain(String.raw`SUMMARY:Planning\, moved`);
    expect(server.writes.at(-1)).toEqual({ ifMatch: "\"1\"", name });
  });

  it("removes the mirror when the source event is gone", async () => {
    const harness = createHarness([buildEvent()]);
    await harness.runSync();
    await harness.runSync();

    harness.events = [];
    const removal = await harness.runSync();
    const settled = await harness.runSync();

    expect(removal).toMatchObject({ removeFailed: 0, removed: 1 });
    expect(settled).toMatchObject({ added: 0, removed: 0 });
    expect(server.names()).toEqual([]);
    expect(harness.mappings).toEqual([]);
  });

  it("puts the mirror back once after it is deleted on the server", async () => {
    const harness = createHarness([buildEvent()]);
    await harness.runSync();
    await harness.runSync();
    const [name] = server.names();
    server.remove(name ?? "");

    const restored = await harness.runSync();
    const second = await harness.runSync();
    const third = await harness.runSync();

    expect(restored).toMatchObject({ addFailed: 0, added: 1 });
    expect(second).toMatchObject({ addFailed: 0, added: 0, removeFailed: 0, removed: 0 });
    expect(third).toMatchObject({ addFailed: 0, added: 0, removeFailed: 0, removed: 0 });
    expect(server.names()).toHaveLength(1);
    expect(harness.mappings).toHaveLength(1);
  });

  it("clears the extra copies of a mirror and settles on one", async () => {
    const event = buildEvent();
    const uid = generateDeterministicEventUid(event.id);
    const harness = createHarness([event]);
    await harness.runSync();
    server.seed(eventToICalString(event, uid));
    server.seed(eventToICalString(event, uid));
    expect(server.names()).toHaveLength(3);

    await harness.runSync();
    const second = await harness.runSync();
    const third = await harness.runSync();

    expect(second).toMatchObject({ addFailed: 0, added: 0, removeFailed: 0, removed: 0 });
    expect(third).toMatchObject({ addFailed: 0, added: 0, removeFailed: 0, removed: 0 });
    expect(server.names()).toHaveLength(1);
    expect(harness.mappings).toHaveLength(1);
  });

  it("leaves the calendar owner's own events untouched", async () => {
    const owned = server.seed(OWNERS_EVENT);
    const unreadable = server.seed(OWNERS_UNREADABLE_EVENT);
    const harness = createHarness([buildEvent()]);

    const first = await harness.runSync();
    const second = await harness.runSync();

    expect(first).toMatchObject({ addFailed: 0, added: 1, removeFailed: 0, removed: 0 });
    expect(second).toMatchObject({ addFailed: 0, added: 0, removeFailed: 0, removed: 0 });
    expect(server.names()).toHaveLength(3);
    expect(server.read(owned)).toBe(OWNERS_EVENT);
    expect(server.read(unreadable)).toBe(OWNERS_UNREADABLE_EVENT);
  });
});
