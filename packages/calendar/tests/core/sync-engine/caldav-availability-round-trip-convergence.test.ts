import { afterEach, describe, expect, it } from "vitest";
import { syncCalendar } from "../../../src/core/sync-engine/index";
import type { PendingChanges } from "../../../src/core/sync-engine/types";
import type { EventMapping, MaterializedSyncableEvent } from "../../../src/index";
import { createCalDAVSyncProvider } from "../../../src/providers/caldav/destination/provider";
import { eventToICalString } from "../../../src/providers/caldav/shared/ics";
import {
  createRenamingCalDAVServer,
  RENAMING_CALENDAR_URL,
} from "../../providers/caldav/shared/fake-renaming-caldav";
import type {
  RenamingCalDAVServer,
  RenamingCalDAVServerOptions,
} from "../../providers/caldav/shared/fake-renaming-caldav";

const DESTINATION_CALENDAR_ID = "destination-calendar-id";

const WINDOW = {
  timeMax: new Date("2100-01-01T00:00:00.000Z"),
  timeMin: new Date("2000-01-01T00:00:00.000Z"),
};

const SCOPE = { authoritativeWindow: WINDOW, requestedWindow: WINDOW };

const TRANSP_LINE = /^TRANSP:[^\r\n]*\r?\n/gmu;
const BUSY_STATUS_LINE = /^X-MICROSOFT-CDO-BUSYSTATUS:[^\r\n]*\r?\n/gmu;
const END_VEVENT = "END:VEVENT";

const readTransparency = (data: string): string | null =>
  /^TRANSP:(?<value>[^\r\n]*)/mu.exec(data)?.groups?.["value"] ?? null;

const withTransparency = (data: string, transparency: string | null): string => {
  const stripped = data.replaceAll(TRANSP_LINE, "").replaceAll(BUSY_STATUS_LINE, "");
  if (transparency === null) {
    return stripped;
  }
  return stripped.replace(END_VEVENT, `TRANSP:${transparency}\r\n${END_VEVENT}`);
};

const EXCHANGE_GATEWAY: RenamingCalDAVServerOptions = {
  resolvesClientNames: true,
  storeCreated: (data) => {
    if (readTransparency(data) === "OPAQUE" || /^X-MICROSOFT-CDO-BUSYSTATUS:BUSY/mu.test(data)) {
      return withTransparency(data, "OPAQUE");
    }
    return withTransparency(data, "TRANSPARENT");
  },
  storeUpdated: (stored, data) => withTransparency(data, readTransparency(stored)),
};

const DROPS_AVAILABILITY: RenamingCalDAVServerOptions = {
  resolvesClientNames: true,
  storeCreated: (data) => withTransparency(data, null),
  storeUpdated: (_stored, data) => withTransparency(data, null),
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

interface Harness {
  events: MaterializedSyncableEvent[];
  mappings: EventMapping[];
  runSync: () => Promise<Record<string, unknown>>;
}

const createHarness = (events: MaterializedSyncableEvent[]): Harness => {
  const mappings: EventMapping[] = [];
  const harness: Harness = {
    events,
    mappings,
    runSync: async () => {
      const provider = createCalDAVSyncProvider({
        destinationCalendarId: DESTINATION_CALENDAR_ID,
        authMethod: "basic",
        calendarUrl: RENAMING_CALENDAR_URL,
        password: "password",
        serverUrl: RENAMING_CALENDAR_URL,
        username: "someone",
      });
      const emitted: Record<string, unknown>[] = [];
      await syncCalendar({
        calendarId: "destination-calendar",
        flush: (changes) => {
          applyChanges(mappings, changes);
          return Promise.resolve();
        },
        isCurrent: () => Promise.resolve(true),
        onSyncEvent: (wideEvent) => emitted.push(wideEvent),
        provider,
        readState: async () => ({
          existingMappings: mappings.map((mapping) => ({ ...mapping })),
          localEvents: harness.events,
          remoteEvents: await provider.listRemoteEvents(WINDOW),
        }),
        reconciliationScope: SCOPE,
        userId: "user-1",
      });
      return emitted[0] ?? {};
    },
  };
  return harness;
};

const SETTLED = {
  "events.added": 0,
  "events.removed": 0,
  "events.updated": 0,
  "operations.total": 0,
};

let originalFetch: typeof globalThis.fetch = globalThis.fetch;

const useServer = (options: RenamingCalDAVServerOptions): RenamingCalDAVServer => {
  originalFetch = globalThis.fetch;
  const server = createRenamingCalDAVServer(options);
  globalThis.fetch = server.fetch;
  return server;
};

const onlyStoredObject = (server: RenamingCalDAVServer): string => {
  const names = server.names();
  expect(names).toHaveLength(1);
  return server.read(names[0] ?? "") ?? "";
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("a CalDAV destination that stores Exchange busy status", () => {
  it("stores a busy mirror as busy and leaves it alone afterwards", async () => {
    const server = useServer(EXCHANGE_GATEWAY);
    const harness = createHarness([buildEvent()]);

    await harness.runSync();
    const second = await harness.runSync();
    const third = await harness.runSync();

    expect(readTransparency(onlyStoredObject(server))).toBe("OPAQUE");
    expect(second).toMatchObject(SETTLED);
    expect(third).toMatchObject(SETTLED);
    expect(server.writes).toHaveLength(1);
  });

  it("re-creates a mirror once when an update cannot change its availability, then settles", async () => {
    const server = useServer(EXCHANGE_GATEWAY);
    const harness = createHarness([buildEvent()]);
    await harness.runSync();

    harness.events = [buildEvent({ availability: "free" })];
    const changed = await harness.runSync();
    const second = await harness.runSync();
    const third = await harness.runSync();

    expect(changed).toMatchObject({
      "events.added": 1,
      "events.removed": 1,
      "events.update_fallbacks": 1,
      "events.updated": 0,
    });
    expect(readTransparency(onlyStoredObject(server))).toBe("TRANSPARENT");
    expect(second).toMatchObject(SETTLED);
    expect(third).toMatchObject(SETTLED);
  });

  it("repairs a busy mirror an earlier version left stored as free, then settles", async () => {
    const server = useServer(EXCHANGE_GATEWAY);
    const event = buildEvent();
    const harness = createHarness([event]);
    await harness.runSync();
    const [name] = server.names();
    server.remove(name ?? "");
    const legacyMirror = eventToICalString(event, harness.mappings[0]?.destinationEventUid ?? "");
    server.seed(withTransparency(legacyMirror, "TRANSPARENT"));
    for (const mapping of harness.mappings) {
      mapping.remoteAvailability = null;
    }

    const repair = await harness.runSync();
    const second = await harness.runSync();

    expect(repair).toMatchObject({ "stale_mappings.remote_availability_changed_count": 1 });
    expect(readTransparency(onlyStoredObject(server))).toBe("OPAQUE");
    expect(second).toMatchObject(SETTLED);
  });
});

describe("a CalDAV destination that drops availability", () => {
  it("writes a free mirror once and does not rewrite it on every run", async () => {
    const server = useServer(DROPS_AVAILABILITY);
    const harness = createHarness([buildEvent({ availability: "free" })]);

    const first = await harness.runSync();
    const second = await harness.runSync();
    const third = await harness.runSync();

    expect(first).toMatchObject({ "events.added": 1 });
    expect(readTransparency(onlyStoredObject(server))).toBeNull();
    expect(second).toMatchObject(SETTLED);
    expect(third).toMatchObject(SETTLED);
    expect(server.writes).toHaveLength(1);
  });

  it("settles after the source availability changes", async () => {
    const server = useServer(DROPS_AVAILABILITY);
    const harness = createHarness([buildEvent()]);
    await harness.runSync();

    harness.events = [buildEvent({ availability: "free" })];
    await harness.runSync();
    const second = await harness.runSync();
    const third = await harness.runSync();

    expect(server.names()).toHaveLength(1);
    expect(second).toMatchObject(SETTLED);
    expect(third).toMatchObject(SETTLED);
  });
});
