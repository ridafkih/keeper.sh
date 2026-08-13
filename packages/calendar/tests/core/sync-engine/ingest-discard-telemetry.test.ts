import { beforeEach, describe, expect, it, vi } from "vitest";
import { ingestSource } from "../../../src/core/sync-engine/ingest";
import type { IngestWideEventFields, IngestionChanges } from "../../../src/core/sync-engine/ingest";
import type { StoredSourceEventState } from "../../../src/core/source/stored-event-state";
import { createGoogleSourceFetcher } from "../../../src/providers/google/source/fetch-adapter";
import { createCalDAVSourceFetcher } from "../../../src/providers/caldav/source/fetch-adapter";
import { createSourceIngestionPlan } from "../../../src/core/sync/sync-range";

const NOW = new Date("2026-06-15T00:00:00.000Z");
const PLAN = createSourceIngestionPlan("1_month", "2_years", NOW);
const CALENDAR_ID = "calendar-id";

const davMocks = vi.hoisted(() => ({
  calendarQuery: vi.fn(),
  fetchCalendarObjects: vi.fn(),
  fetchCalendars: vi.fn(),
}));

vi.mock("tsdav", () => ({
  DAVNamespaceShort: { DAV: "d" },
  createDAVClient: () => Promise.resolve({
    calendarQuery: davMocks.calendarQuery,
    fetchCalendarObjects: davMocks.fetchCalendarObjects,
    fetchCalendars: davMocks.fetchCalendars,
  }),
}));

const storedEvent = (
  overrides: Partial<StoredSourceEventState> & Pick<StoredSourceEventState, "id">,
): StoredSourceEventState => ({
  endTime: new Date("2026-06-20T10:00:00.000Z"),
  exceptionDates: null,
  recurrenceId: null,
  recurrenceRule: null,
  sourceEventId: null,
  sourceEventUid: null,
  startTime: new Date("2026-06-20T09:00:00.000Z"),
  startTimeZone: null,
  ...overrides,
});

interface IngestRun {
  changes: IngestionChanges[];
  wideEvents: IngestWideEventFields[];
}

const runIngest = async (
  calendarId: string,
  fetchEvents: Parameters<typeof ingestSource>[0]["fetchEvents"],
  stored: StoredSourceEventState[],
): Promise<IngestRun> => {
  const run: IngestRun = { changes: [], wideEvents: [] };
  let remaining = stored;
  await ingestSource({
    calendarId,
    fetchEvents,
    flush: (changes) => {
      run.changes.push(changes);
      const deleted = new Set(changes.deletes);
      remaining = remaining.filter((event) => !deleted.has(event.id));
      return Promise.resolve();
    },
    onIngestEvent: (event) => {
      run.wideEvents.push({ ...event });
    },
    readExistingEvents: () => Promise.resolve(remaining),
  });
  return run;
};

const originalFetch = globalThis.fetch;

const respondWith = (body: unknown): void => {
  const stub = (): Promise<Response> => Promise.resolve(Response.json(body));
  stub.preconnect = originalFetch.preconnect;
  globalThis.fetch = stub;
};

describe("Google delta discards", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("counts a changed event the parser cannot represent and reports the row it deletes", async () => {
    respondWith({
      items: [
        {
          end: { dateTime: "2026-06-20T15:00:00.000Z" },
          iCalUID: "kept@example.com",
          id: "kept-id",
          start: { dateTime: "2026-06-20T14:00:00.000Z" },
          status: "confirmed",
        },
        {
          end: { dateTime: "2026-06-21T15:00:00.000Z" },
          id: "no-uid-id",
          start: { dateTime: "2026-06-21T14:00:00.000Z" },
          status: "confirmed",
        },
      ],
      nextSyncToken: "next-token",
    });
    const fetcher = createGoogleSourceFetcher({
      accessToken: "token",
      calendarId: CALENDAR_ID,
      externalCalendarId: "primary",
      plan: PLAN,
      syncToken: "stored-token",
    });

    const run = await runIngest(CALENDAR_ID, () => fetcher.fetchEvents(), [
      storedEvent({ id: "state-kept", sourceEventId: "kept-id", sourceEventUid: "kept@example.com" }),
      storedEvent({
        endTime: new Date("2026-06-21T15:00:00.000Z"),
        id: "state-dropped",
        sourceEventId: "no-uid-id",
        sourceEventUid: "dropped@example.com",
        startTime: new Date("2026-06-21T14:00:00.000Z"),
      }),
    ]);

    expect(run.changes[0]?.deletes).toEqual(["state-dropped"]);
    expect(run.wideEvents[0]?.["source_events.discarded_unrepresentable"]).toBe(1);
    expect(run.wideEvents[0]?.["events.removed"]).toBe(1);
  });

  it("stays converged when the same unrepresentable delta replays", async () => {
    respondWith({
      items: [{
        end: { dateTime: "2026-06-21T15:00:00.000Z" },
        id: "no-uid-id",
        start: { dateTime: "2026-06-21T14:00:00.000Z" },
        status: "confirmed",
      }],
      nextSyncToken: "next-token",
    });
    const fetcher = createGoogleSourceFetcher({
      accessToken: "token",
      calendarId: CALENDAR_ID,
      externalCalendarId: "primary",
      plan: PLAN,
      syncToken: "stored-token",
    });
    const stored = [storedEvent({
      endTime: new Date("2026-06-21T15:00:00.000Z"),
      id: "state-dropped",
      sourceEventId: "no-uid-id",
      sourceEventUid: "dropped@example.com",
      startTime: new Date("2026-06-21T14:00:00.000Z"),
    })];

    const first = await runIngest(CALENDAR_ID, () => fetcher.fetchEvents(), stored);
    const second = await runIngest(CALENDAR_ID, () => fetcher.fetchEvents(), []);

    expect(first.changes[0]?.deletes).toEqual(["state-dropped"]);
    expect(first.wideEvents[0]?.["source_events.discarded_unrepresentable"]).toBe(1);
    expect(second.changes.flatMap((change) => change.deletes)).toEqual([]);
    expect(second.wideEvents[0]?.["source_events.discarded_unrepresentable"]).toBe(1);
    expect(second.wideEvents[0]?.["events.removed"]).toBe(0);
  });

  it("emits only values a wide event can carry", async () => {
    respondWith({
      items: [{
        end: { dateTime: "2026-06-20T15:00:00.000Z" },
        iCalUID: "kept@example.com",
        id: "kept-id",
        start: { dateTime: "2026-06-20T14:00:00.000Z" },
        status: "confirmed",
      }],
      nextSyncToken: "next-token",
    });
    const fetcher = createGoogleSourceFetcher({
      accessToken: "token",
      calendarId: CALENDAR_ID,
      externalCalendarId: "primary",
      plan: PLAN,
      syncToken: "stored-token",
    });

    const run = await runIngest(CALENDAR_ID, () => fetcher.fetchEvents(), [
      storedEvent({
        exceptionDates: "{not json",
        id: "state-invalid",
        sourceEventId: "gone-id",
        sourceEventUid: "gone@example.com",
      }),
    ]);

    const wideEvent = run.wideEvents[0] ?? {};
    expect(Object.keys(wideEvent).length).toBeGreaterThan(0);
    for (const [key, value] of Object.entries(wideEvent)) {
      expect(
        ["boolean", "number", "string"].includes(typeof value),
        `${key} carries a ${typeof value}: ${JSON.stringify(value)}`,
      ).toBe(true);
    }
  });
});

describe("Google full sync discards", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("counts a window drop that deletes a stored row on a full sync", async () => {
    respondWith({
      items: [{
        end: { dateTime: "2099-06-20T15:00:00.000Z" },
        iCalUID: "far-future@example.com",
        id: "far-future-id",
        start: { dateTime: "2099-06-20T14:00:00.000Z" },
        status: "confirmed",
      }],
      nextSyncToken: "next-token",
    });
    const fetcher = createGoogleSourceFetcher({
      accessToken: "token",
      calendarId: CALENDAR_ID,
      externalCalendarId: "primary",
      plan: PLAN,
      syncToken: null,
    });

    const run = await runIngest(CALENDAR_ID, () => fetcher.fetchEvents(), [
      storedEvent({
        endTime: new Date("2099-06-20T15:00:00.000Z"),
        id: "state-far-future",
        sourceEventId: "far-future-id",
        sourceEventUid: "far-future@example.com",
        startTime: new Date("2099-06-20T14:00:00.000Z"),
      }),
    ]);

    expect(run.changes[0]?.deletes).toEqual(["state-far-future"]);
    expect(run.wideEvents[0]?.["source_events.discarded_outside_window"]).toBe(1);
  });
});

describe("Outlook delta discards", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("counts a changed event the parser cannot represent", async () => {
    respondWith({
      "@odata.deltaLink": "https://graph.example.com/delta?token=next",
      value: [{
        end: { dateTime: "2026-06-20T15:00:00.0000000", timeZone: "UTC" },
        iCalUId: "outlook-uid-1",
        id: "outlook-id-1",
        start: { dateTime: "2026-06-20T14:00:00.0000000" },
        type: "singleInstance",
      }],
    });
    const { createOutlookSourceFetcher } = await import(
      "../../../src/providers/outlook/source/fetch-adapter"
    );
    const fetcher = createOutlookSourceFetcher({
      accessToken: "token",
      calendarId: CALENDAR_ID,
      externalCalendarId: "primary",
      plan: PLAN,
      syncToken: null,
    });

    const result = await fetcher.fetchEvents();

    expect(result.events).toEqual([]);
    expect(result.discardedEventCounts).toEqual({
      outsideSyncWindow: 0,
      unrepresentable: 1,
    });
  });
});

describe("sync window boundaries", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("counts a delta event that ends exactly on the window start", async () => {
    const windowStart = PLAN.window.timeMin;
    respondWith({
      items: [{
        end: { dateTime: windowStart.toISOString() },
        iCalUID: "edge@example.com",
        id: "edge-id",
        start: { dateTime: new Date(windowStart.getTime() - 3_600_000).toISOString() },
        status: "confirmed",
      }],
      nextSyncToken: "next-token",
    });
    const fetcher = createGoogleSourceFetcher({
      accessToken: "token",
      calendarId: CALENDAR_ID,
      externalCalendarId: "primary",
      plan: PLAN,
      syncToken: "stored-token",
    });

    const result = await fetcher.fetchEvents();

    expect(result.events).toEqual([]);
    expect(result.discardedEventCounts).toEqual({
      outsideSyncWindow: 1,
      unrepresentable: 0,
    });
  });

  it("separates Keeper's own mirrored events from events it lost", async () => {
    respondWith({
      items: Array.from({ length: 3 }, (_unused, index) => ({
        end: { dateTime: "2026-06-20T15:00:00.000Z" },
        iCalUID: `keeper-${String(index)}@keeper.sh`,
        id: `keeper-id-${String(index)}`,
        start: { dateTime: "2026-06-20T14:00:00.000Z" },
        status: "confirmed",
      })),
      nextSyncToken: "next-token",
    });
    const fetcher = createGoogleSourceFetcher({
      accessToken: "token",
      calendarId: CALENDAR_ID,
      externalCalendarId: "primary",
      plan: PLAN,
      syncToken: null,
    });

    const result = await fetcher.fetchEvents();

    expect(result.events).toEqual([]);
    expect(result.discardedEventCounts?.unrepresentable).toBe(0);
  });
});

const SERVER_URL = "https://caldav.example.com";
const CALENDAR_PATH = "/cal/u/";

const icsFor = (uid: string, start: string, end: string): string => [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//keeper.sh//test//EN",
  "BEGIN:VEVENT",
  `UID:${uid}`,
  "DTSTAMP:20260601T000000Z",
  `DTSTART:${start}`,
  `DTEND:${end}`,
  "SUMMARY:Test event",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const TRUNCATED_ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//keeper.sh//test//EN",
  "BEGIN:VEVENT",
  "UID:truncated@example.com",
  "DTSTART:20260620T090000Z",
].join("\r\n");

const answerWith = (resources: string[]): void => {
  const hrefs = resources.map(
    (_unused, index) => `${CALENDAR_PATH}event-${String(index)}.ics`,
  );
  davMocks.calendarQuery.mockResolvedValue(hrefs.map((href) => ({ href })));
  davMocks.fetchCalendarObjects.mockResolvedValue(
    resources.map((data, index) => ({ data, url: `${SERVER_URL}${hrefs[index]}` })),
  );
};

const createCalDAVFetcher = () => createCalDAVSourceFetcher({
  calendarUrl: `${SERVER_URL}${CALENDAR_PATH}`,
  password: "pass",
  plan: PLAN,
  serverUrl: SERVER_URL,
  username: "user",
});

describe("CalDAV discards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    davMocks.fetchCalendars.mockResolvedValue([]);
  });

  it("reports the unreadable resource whose stored event it deletes", async () => {
    answerWith([
      icsFor("readable@example.com", "20260620T090000Z", "20260620T100000Z"),
      TRUNCATED_ICS,
    ]);
    const fetcher = createCalDAVFetcher();

    const run = await runIngest("caldav-calendar", () => fetcher.fetchEvents(), [
      storedEvent({ id: "state-readable", sourceEventUid: "readable@example.com" }),
      storedEvent({ id: "state-truncated", sourceEventUid: "truncated@example.com" }),
    ]);

    expect(run.changes[0]?.deletes).toEqual(["state-truncated"]);
    const wideEvent = run.wideEvents[0] ?? {};
    const discardKeys = Object.keys(wideEvent).filter((key) =>
      key.includes("discard") || key.includes("skipped") || key.includes("unsupported"));
    expect(discardKeys).not.toEqual([]);
    expect(wideEvent["source_events.skipped_resources"]).toBe(1);
    expect(wideEvent["source_events.skipped_resource_reasons"]).toContain("END:VEVENT");
  });

  it("counts a stored event dropped for falling outside the sync window", async () => {
    answerWith([
      icsFor("in-window@example.com", "20260620T090000Z", "20260620T100000Z"),
      icsFor("out-of-window@example.com", "20990620T090000Z", "20990620T100000Z"),
    ]);
    const fetcher = createCalDAVFetcher();

    const run = await runIngest("caldav-calendar", () => fetcher.fetchEvents(), [
      storedEvent({ id: "state-in-window", sourceEventUid: "in-window@example.com" }),
      storedEvent({
        endTime: new Date("2099-06-20T10:00:00.000Z"),
        id: "state-out-of-window",
        sourceEventUid: "out-of-window@example.com",
        startTime: new Date("2099-06-20T09:00:00.000Z"),
      }),
    ]);

    expect(run.changes[0]?.deletes).toEqual(["state-out-of-window"]);
    expect(run.wideEvents[0]?.["source_events.discarded_outside_window"]).toBe(1);
  });
});
