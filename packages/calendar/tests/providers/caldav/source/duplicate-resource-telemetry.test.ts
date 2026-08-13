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

const FIRST_COPY = [
  "UID:duplicated@example.com",
  "DTSTAMP:20260601T000000Z",
  "LAST-MODIFIED:20260601T000000Z",
  "STATUS:CONFIRMED",
  "DTSTART:20260620T090000Z",
  "DTEND:20260620T093000Z",
  "SUMMARY:Standup",
];

const SECOND_COPY = [
  "UID:duplicated@example.com",
  "DTSTAMP:20260501T000000Z",
  "LAST-MODIFIED:20260501T000000Z",
  "STATUS:CONFIRMED",
  "DTSTART:20260620T140000Z",
  "DTEND:20260620T143000Z",
  "SUMMARY:Standup (old slot)",
];

const OTHER_EVENT = [
  "UID:other@example.com",
  "DTSTAMP:20260601T000000Z",
  "LAST-MODIFIED:20260601T000000Z",
  "STATUS:CONFIRMED",
  "DTSTART:20260621T090000Z",
  "DTEND:20260621T093000Z",
  "SUMMARY:Other",
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

const storedId = (event: SourceEvent): string =>
  `state-${event.uid}-${event.startTime.toISOString()}`;

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

const alternatingCollisionOrder = (poll: number): string[] => {
  if (poll % 2 === 0) {
    return [resource(SECOND_COPY), resource(FIRST_COPY)];
  }
  return [resource(FIRST_COPY), resource(SECOND_COPY)];
};

describe("CalDAV duplicate-UID resources", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    davMocks.fetchCalendars.mockResolvedValue([]);
  });

  it("counts the resource it collapses away", async () => {
    const store = createStore();

    const run = await ingestCollection(store, [
      resource(FIRST_COPY),
      resource(SECOND_COPY),
      resource(OTHER_EVENT),
    ]);

    expect(run.wideEvent["source_events.count"]).toBe(2);
    expect(run.wideEvent["source_events.skipped_resources"]).toBeUndefined();
    expect(discardTotal(run.wideEvent)).toBe(1);
  });

  it("keeps the same resource across repeated polls in either order", async () => {
    const store = createStore();

    const first = await ingestCollection(store, [resource(FIRST_COPY), resource(SECOND_COPY)]);
    expect(first.inserts).toEqual(["state-duplicated@example.com-2026-06-20T09:00:00.000Z"]);

    for (let poll = 0; poll < 3; poll += 1) {
      const repeat = await ingestCollection(
        store,
        alternatingCollisionOrder(poll),
      );
      expect(repeat.inserts).toEqual([]);
      expect(repeat.deletes).toEqual([]);
    }

    expect(store.ids()).toEqual(["state-duplicated@example.com-2026-06-20T09:00:00.000Z"]);
  });
});
