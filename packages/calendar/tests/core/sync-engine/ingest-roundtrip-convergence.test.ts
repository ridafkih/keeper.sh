import { beforeEach, describe, expect, it, vi } from "vitest";
import { ingestSource } from "../../../src/core/sync-engine/ingest";
import type { IngestWideEventFields } from "../../../src/core/sync-engine/ingest";
import { buildEventStateInsertRow } from "../../../src/core/source/write-event-states";
import type { StoredSourceEventState } from "../../../src/core/source/stored-event-state";
import { createCalDAVSourceFetcher } from "../../../src/providers/caldav/source/fetch-adapter";
import { createSourceIngestionPlan } from "../../../src/core/sync/sync-range";

const NOW = new Date("2026-06-15T00:00:00.000Z");
const PLAN = createSourceIngestionPlan("1_month", "2_years", NOW);

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

// Postgres reads an absent optional value back as null, never undefined.
const nullify = <Value,>(value: Value | undefined): Value | null => value ?? null;

let nextRowId = 0;

const persistInsert = (
  calendarId: string,
  event: Parameters<typeof buildEventStateInsertRow>[1],
): StoredSourceEventState => {
  const row = buildEventStateInsertRow(calendarId, event);
  nextRowId += 1;
  return {
    availability: nullify(row.availability),
    description: nullify(row.description),
    endTime: row.endTime,
    exceptionDates: nullify(row.exceptionDates),
    id: `row-${String(nextRowId)}`,
    isAllDay: nullify(row.isAllDay),
    location: nullify(row.location),
    recurrenceId: nullify(row.recurrenceId),
    recurrenceRule: nullify(row.recurrenceRule),
    sourceEventId: nullify(row.sourceEventId),
    sourceEventType: nullify(row.sourceEventType),
    sourceEventUid: row.sourceEventUid,
    startTime: row.startTime,
    startTimeZone: nullify(row.startTimeZone),
    title: nullify(row.title),
  } as StoredSourceEventState;
};

const CALENDAR_ID = "caldav-convergence";

const buildIcs = (uid: string, body: string): string =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Probe//Probe//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    body,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

const RESOURCES = [
  {
    data: buildIcs(
      "timed-1",
      ["DTSTAMP:20260601T000000Z", "DTSTART:20260620T090000Z", "DTEND:20260620T100000Z", "SUMMARY:Timed"].join("\r\n"),
    ),
    url: "/cal/timed-1.ics",
  },
  {
    data: buildIcs(
      "allday-1",
      ["DTSTAMP:20260601T000000Z", "DTSTART;VALUE=DATE:20260622", "DTEND;VALUE=DATE:20260623", "SUMMARY:All day"].join("\r\n"),
    ),
    url: "/cal/allday-1.ics",
  },
  {
    data: buildIcs(
      "recurring-1",
      [
        "DTSTAMP:20260601T000000Z",
        "DTSTART:20260624T090000Z",
        "DTEND:20260624T093000Z",
        "RRULE:FREQ=WEEKLY;COUNT=6",
        "SUMMARY:Weekly",
      ].join("\r\n"),
    ),
    url: "/cal/recurring-1.ics",
  },
  {
    data: buildIcs(
      "zoned-1",
      [
        "DTSTAMP:20260601T000000Z",
        "DTSTART;TZID=America/New_York:20260625T090000",
        "DTEND;TZID=America/New_York:20260625T100000",
        "SUMMARY:Zoned",
      ].join("\r\n"),
    ),
    url: "/cal/zoned-1.ics",
  },
];

interface RoundtripRound {
  added: number;
  removed: number;
  store: StoredSourceEventState[];
  wideEvent: IngestWideEventFields;
}

const runRound = async (
  initialStore: readonly StoredSourceEventState[],
  fetchEvents: () => ReturnType<ReturnType<typeof createCalDAVSourceFetcher>["fetchEvents"]>,
): Promise<RoundtripRound> => {
  let store = [...initialStore];
  let wideEvent: IngestWideEventFields = {};

  const result = await ingestSource({
    calendarId: CALENDAR_ID,
    fetchEvents,
    flush: (changes) => {
      const deleted = new Set(changes.deletes);
      store = [
        ...store.filter((entry) => !deleted.has(entry.id)),
        ...changes.inserts.map((insert) => persistInsert(CALENDAR_ID, insert)),
      ];
      return Promise.resolve();
    },
    onIngestEvent: (event) => {
      wideEvent = { ...event };
    },
    readExistingEvents: () => Promise.resolve([...store]),
  });

  return {
    added: result.eventsAdded,
    removed: result.eventsRemoved,
    store,
    wideEvent,
  };
};

const buildFetcher = () =>
  createCalDAVSourceFetcher({
    calendarUrl: "https://dav.example.com/cal/",
    password: "password",
    plan: PLAN,
    serverUrl: "https://dav.example.com",
    username: "user",
  });

const runRoundtripRounds = async (rounds: number): Promise<RoundtripRound[]> => {
  const fetcher = buildFetcher();
  const history: RoundtripRound[] = [];
  let store: StoredSourceEventState[] = [];

  for (let round = 0; round < rounds; round += 1) {
    const outcome = await runRound(store, () => fetcher.fetchEvents());
    ({ store } = outcome);
    history.push(outcome);
  }

  return history;
};

describe("CalDAV snapshot ingest converges across repeated syncs", () => {
  beforeEach(() => {
    nextRowId = 0;
    davMocks.fetchCalendars.mockResolvedValue([
      { displayName: "Cal", url: "https://dav.example.com/cal/" },
    ]);
    davMocks.fetchCalendarObjects.mockResolvedValue(RESOURCES);
    davMocks.calendarQuery.mockResolvedValue(
      RESOURCES.map((resource) => ({ href: resource.url, props: { getetag: `"${resource.url}"` } })),
    );
  });

  it("inserts once and reports in-sync on every later run", async () => {
    const rounds = await runRoundtripRounds(5);

    const trace = rounds
      .map((round) => `${String(round.added)}/${String(round.removed)}`)
      .join(" ");

    expect(rounds[0]?.added, `add/remove per round: ${trace}`).toBeGreaterThan(0);
    expect(
      rounds.slice(1).every((round) => round.added === 0 && round.removed === 0),
      `add/remove per round: ${trace}`,
    ).toBe(true);
    expect(rounds.at(-1)?.wideEvent["outcome"]).toBe("in-sync");
  });

  it("keeps discard telemetry present and stable on every run", async () => {
    const rounds = await runRoundtripRounds(4);
    const seen = rounds.map((round) => round.wideEvent);

    for (const wideEvent of seen) {
      expect(wideEvent["source_events.discarded_outside_window"]).toBe(0);
      expect(wideEvent["source_events.discarded_unrepresentable"]).toBe(0);
      expect(wideEvent["source_events.count"]).toBe(seen[0]?.["source_events.count"]);
    }
  });
});
