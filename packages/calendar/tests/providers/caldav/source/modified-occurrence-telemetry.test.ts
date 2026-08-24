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

const MASTER_LINES = [
  "UID:weekly@example.com",
  "DTSTAMP:20260601T000000Z",
  "DTSTART:20260620T090000Z",
  "DTEND:20260620T093000Z",
  "RRULE:FREQ=WEEKLY;COUNT=4",
  "SUMMARY:Standup",
];

const OVERRIDE_LINES = [
  "UID:weekly@example.com",
  "DTSTAMP:20260601T000000Z",
  "RECURRENCE-ID:20260627T090000Z",
  "DTSTART:20260627T110000Z",
  "DTEND:20260627T113000Z",
  "SUMMARY:Standup (moved)",
];

const OVERRIDE_LINES_MISSING_DTSTART = [
  "UID:weekly@example.com",
  "DTSTAMP:20260601T000000Z",
  "RECURRENCE-ID:20260627T090000Z",
  "DTEND:20260627T113000Z",
  "SUMMARY:Standup (moved)",
];

// A master and all its overrides share one .ics on iCloud and Fastmail.
const seriesResource = (overrideLines: string[]): string => [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//keeper.sh//test//EN",
  "BEGIN:VEVENT",
  ...MASTER_LINES,
  "END:VEVENT",
  "BEGIN:VEVENT",
  ...overrideLines,
  "END:VEVENT",
  "END:VCALENDAR",
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

const storedId = (event: SourceEvent): string =>
  `state-${event.uid}-${event.recurrenceId?.toISOString() ?? "master"}`;

const stringifyOrNull = (value: unknown): string | null => {
  if (!value) {
    return null;
  }
  return JSON.stringify(value);
};

const toStoredState = (event: SourceEvent): StoredSourceEventState => ({
  availability: event.availability ?? null,
  description: event.description ?? null,
  endTime: event.endTime,
  exceptionDates: stringifyOrNull(event.exceptionDates),
  id: storedId(event),
  isAllDay: event.isAllDay ?? null,
  location: event.location ?? null,
  recurrenceId: event.recurrenceId ?? null,
  recurrenceRule: stringifyOrNull(event.recurrenceRule),
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
  wideEvent: IngestWideEventFields;
}

const createStore = () => {
  let rows: StoredSourceEventState[] = [];
  return {
    read: (): StoredSourceEventState[] => rows,
    apply: (inserts: SourceEvent[], deletes: string[]): void => {
      const removed = new Set(deletes);
      const upserted = inserts.map((event) => toStoredState(event));
      const replaced = new Set(upserted.map(({ id }) => id));
      rows = [
        ...rows.filter((row) => !removed.has(row.id) && !replaced.has(row.id)),
        ...upserted,
      ];
    },
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
  const outcome: RunOutcome = { deletes: [], inserts: [], wideEvent: {} };

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

  return outcome;
};

describe("CalDAV modified occurrence discards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    davMocks.fetchCalendars.mockResolvedValue([]);
  });

  it("counts a modified occurrence the server stopped giving a DTSTART", async () => {
    const store = createStore();

    const first = await ingestCollection(store, [seriesResource(OVERRIDE_LINES)]);
    expect(first.inserts.toSorted()).toEqual([
      "state-weekly@example.com-2026-06-27T09:00:00.000Z",
      "state-weekly@example.com-master",
    ]);

    const second = await ingestCollection(
      store,
      [seriesResource(OVERRIDE_LINES_MISSING_DTSTART)],
    );

    expect(second.deletes).toEqual(["state-weekly@example.com-2026-06-27T09:00:00.000Z"]);
    expect(second.wideEvent["events.removed"]).toBe(1);
    expect(discardTotal(second.wideEvent)).toBe(1);
  });

  it("settles after the deletion and keeps reporting the discard", async () => {
    const store = createStore();

    await ingestCollection(store, [seriesResource(OVERRIDE_LINES)]);
    await ingestCollection(store, [seriesResource(OVERRIDE_LINES_MISSING_DTSTART)]);
    const third = await ingestCollection(
      store,
      [seriesResource(OVERRIDE_LINES_MISSING_DTSTART)],
    );

    expect(third.inserts).toEqual([]);
    expect(third.deletes).toEqual([]);
    expect(store.read().map(({ id }) => id)).toEqual(["state-weekly@example.com-master"]);
    expect(discardTotal(third.wideEvent)).toBe(1);
  });
});
