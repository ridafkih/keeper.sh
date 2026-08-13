import { beforeEach, describe, expect, it, vi } from "vitest";
import { ingestSource } from "../../../../src/core/sync-engine/ingest";
import type { IngestWideEventFields } from "../../../../src/core/sync-engine/ingest";
import type { StoredSourceEventState } from "../../../../src/core/source/stored-event-state";
import type { SourceEvent } from "../../../../src/core/types";
import { createCalDAVSourceFetcher } from "../../../../src/providers/caldav/source/fetch-adapter";
import { createSourceIngestionPlan } from "../../../../src/core/sync/sync-range";

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

const NOW = new Date("2026-06-15T00:00:00.000Z");
const PLAN = createSourceIngestionPlan("1_month", "2_years", NOW);
const SERVER_URL = "https://caldav.example.com";
const CALENDAR_PATH = "/cal/u/";
const CALENDAR_ID = "caldav-calendar";

const resource = (lines: string[]): string => [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//keeper.sh//test//EN",
  "BEGIN:VEVENT",
  ...lines,
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const STANDUP = [
  "UID:standup@example.com",
  "DTSTAMP:20260601T000000Z",
  "DTSTART:20260620T090000Z",
  "DTEND:20260620T093000Z",
  "SUMMARY:Standup",
];

const DINNER = [
  "UID:dinner@example.com",
  "DTSTAMP:20260601T000000Z",
  "DTSTART:20260621T190000Z",
  "DTEND:20260621T200000Z",
  "SUMMARY:Dinner",
];

const ALL_DAY_HOUR_DURATION = [
  "UID:offsite@example.com",
  "DTSTAMP:20260601T000000Z",
  "DTSTART;VALUE=DATE:20260622",
  "DURATION:PT24H",
  "SUMMARY:Offsite",
];

const UNRESOLVABLE_ZONE_SERIES = [
  "UID:weekly@example.com",
  "DTSTAMP:20260601T000000Z",
  "DTSTART;TZID=Customized Time Zone 3:20260623T090000",
  "DTEND;TZID=Customized Time Zone 3:20260623T093000",
  "RRULE:FREQ=WEEKLY;COUNT=5",
  "SUMMARY:Weekly",
];

const answerWith = (resources: string[]): void => {
  const hrefs = resources.map(
    (_unused, index) => `${CALENDAR_PATH}event-${String(index)}.ics`,
  );
  davMocks.calendarQuery.mockResolvedValue(hrefs.map((href) => ({ href })));
  davMocks.fetchCalendarObjects.mockResolvedValue(
    resources.map((data, index) => ({ data, url: `${SERVER_URL}${hrefs[index]}` })),
  );
};

const storedId = (event: SourceEvent): string => `state-${event.uid}`;

const toStoredState = (event: SourceEvent): StoredSourceEventState => ({
  availability: event.availability ?? null,
  description: event.description ?? null,
  endTime: event.endTime,
  exceptionDates: null,
  id: storedId(event),
  isAllDay: event.isAllDay ?? null,
  location: event.location ?? null,
  recurrenceId: event.recurrenceId ?? null,
  recurrenceRule: null,
  sourceEventId: event.sourceEventId ?? null,
  sourceEventType: event.sourceEventType ?? null,
  sourceEventUid: event.uid,
  startTime: event.startTime,
  startTimeZone: event.startTimeZone ?? null,
  title: event.title ?? null,
});

const DISCARD_KEYS = [
  "source_events.discarded_outside_window",
  "source_events.discarded_unrepresentable",
  "source_events.skipped_resources",
  "source_events.skipped_self_authored",
  "source_events.unsupported_count",
];

const discardTotal = (wideEvent: IngestWideEventFields): number => {
  let total = 0;
  for (const key of DISCARD_KEYS) {
    const value = wideEvent[key];
    if (typeof value === "number") {
      total += value;
    }
  }
  return total;
};

interface RunOutcome {
  deletes: string[];
  inserts: string[];
  status: string;
  wideEvent: IngestWideEventFields;
}

const createStore = () => {
  let rows: StoredSourceEventState[] = [];
  return {
    apply: (inserts: SourceEvent[], deletes: string[]): void => {
      const removed = new Set(deletes);
      const upserted = inserts.map((event) => toStoredState(event));
      const replaced = new Set(upserted.map(({ id }) => id));
      rows = [
        ...rows.filter((row) => !removed.has(row.id) && !replaced.has(row.id)),
        ...upserted,
      ];
    },
    ids: (): string[] => rows.map(({ id }) => id).toSorted(),
    read: (): StoredSourceEventState[] => rows,
  };
};

const ingestCollection = async (
  store: ReturnType<typeof createStore>,
  resources: string[],
): Promise<RunOutcome> => {
  answerWith(resources);
  const fetcher = createCalDAVSourceFetcher({
    calendarUrl: `${SERVER_URL}${CALENDAR_PATH}`,
    password: "pass",
    plan: PLAN,
    serverUrl: SERVER_URL,
    username: "user",
  });
  const outcome: RunOutcome = { deletes: [], inserts: [], status: "", wideEvent: {} };

  try {
    await ingestSource({
      calendarId: CALENDAR_ID,
      fetchEvents: () => fetcher.fetchEvents(),
      flush: (changes) => {
        outcome.deletes.push(...changes.deletes);
        outcome.inserts.push(...changes.inserts.map((event) => storedId(event)));
        store.apply(changes.inserts, changes.deletes);
        return Promise.resolve();
      },
      onIngestEvent: (event) => {
        outcome.wideEvent = { ...event };
      },
      readExistingEvents: () => Promise.resolve(store.read()),
    });
  } catch (error) {
    outcome.status = `throw:${(error as Error).message}`;
    return outcome;
  }

  outcome.status = String(outcome.wideEvent["outcome"] ?? "");
  return outcome;
};

describe("CalDAV collections holding one unbuildable VEVENT", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    davMocks.fetchCalendars.mockResolvedValue([]);
  });

  it("ingests the healthy control collection with no discards", async () => {
    const store = createStore();

    const run = await ingestCollection(store, [resource(STANDUP), resource(DINNER)]);

    expect(run.status).toBe("success");
    expect(run.inserts.toSorted()).toEqual([
      "state-dinner@example.com",
      "state-standup@example.com",
    ]);
    expect(discardTotal(run.wideEvent)).toBe(0);
  });

  it("keeps the collection syncing when one resource holds an hour-based all-day DURATION", async () => {
    const store = createStore();

    const run = await ingestCollection(store, [
      resource(STANDUP),
      resource(ALL_DAY_HOUR_DURATION),
      resource(DINNER),
    ]);

    expect(run.status).toBe("success");
    expect(run.inserts.toSorted()).toEqual([
      "state-dinner@example.com",
      "state-standup@example.com",
    ]);
    expect(discardTotal(run.wideEvent)).toBe(1);
  });

  it("keeps the collection syncing when one series carries an unresolvable TZID", async () => {
    const store = createStore();

    const run = await ingestCollection(store, [
      resource(STANDUP),
      resource(UNRESOLVABLE_ZONE_SERIES),
      resource(DINNER),
    ]);

    expect(run.status).toBe("success");
    expect(run.inserts.toSorted()).toEqual([
      "state-dinner@example.com",
      "state-standup@example.com",
    ]);
    expect(discardTotal(run.wideEvent)).toBe(1);
  });

  it("applies a deletion the server made in the same poll as an unbuildable VEVENT", async () => {
    const store = createStore();

    await ingestCollection(store, [resource(STANDUP), resource(DINNER)]);
    expect(store.ids()).toEqual([
      "state-dinner@example.com",
      "state-standup@example.com",
    ]);

    const run = await ingestCollection(store, [
      resource(STANDUP),
      resource(ALL_DAY_HOUR_DURATION),
    ]);

    expect(run.deletes).toEqual(["state-dinner@example.com"]);
    expect(store.ids()).toEqual(["state-standup@example.com"]);
  });

  it("converges over repeated polls while the unbuildable resource stays put", async () => {
    const store = createStore();
    const resources = [
      resource(STANDUP),
      resource(ALL_DAY_HOUR_DURATION),
      resource(DINNER),
    ];

    const statuses: string[] = [];
    for (let poll = 0; poll < 3; poll += 1) {
      const run = await ingestCollection(store, resources);
      statuses.push(run.status);
    }

    expect(statuses).toEqual(["success", "in-sync", "in-sync"]);
    expect(store.ids()).toEqual([
      "state-dinner@example.com",
      "state-standup@example.com",
    ]);
  });
});
