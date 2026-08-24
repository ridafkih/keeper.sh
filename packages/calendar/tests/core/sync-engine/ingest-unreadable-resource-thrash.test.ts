import { beforeEach, describe, expect, it, vi } from "vitest";
import { ingestSource } from "../../../src/core/sync-engine/ingest";
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
const nullify = <Value,>(value: Value | null): Value | null => value ?? null;

let nextRowId = 0;

const persistInsert = (
  calendarId: string,
  event: Parameters<typeof buildEventStateInsertRow>[1],
): StoredSourceEventState => {
  const row = buildEventStateInsertRow(calendarId, event);
  nextRowId += 1;
  return {
    availability: nullify(row.availability ?? null),
    description: nullify(row.description ?? null),
    endTime: row.endTime,
    exceptionDates: nullify(row.exceptionDates ?? null),
    id: `row-${String(nextRowId)}`,
    isAllDay: nullify(row.isAllDay ?? null),
    location: nullify(row.location ?? null),
    recurrenceId: nullify(row.recurrenceId ?? null),
    recurrenceRule: nullify(row.recurrenceRule ?? null),
    sourceEventId: nullify(row.sourceEventId ?? null),
    sourceEventType: nullify(row.sourceEventType ?? null),
    sourceEventUid: row.sourceEventUid,
    startTime: row.startTime,
    startTimeZone: nullify(row.startTimeZone ?? null),
    title: nullify(row.title ?? null),
  } as StoredSourceEventState;
};

const CALENDAR_ID = "caldav-unreadable-resource";

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

const STABLE_ICS = buildIcs(
  "stable-1",
  ["DTSTAMP:20260601T000000Z", "DTSTART:20260620T090000Z", "DTEND:20260620T100000Z", "SUMMARY:Stable"].join("\r\n"),
);

const FLICKERING_ICS = buildIcs(
  "flickering-1",
  ["DTSTAMP:20260601T000000Z", "DTSTART:20260622T090000Z", "DTEND:20260622T100000Z", "SUMMARY:Flickering"].join("\r\n"),
);

const STABLE_URL = "/cal/stable-1.ics";
const FLICKERING_URL = "/cal/flickering-1.ics";

// An empty calendar-data body counts as returned, not missing: unreadable looks deleted.
const answerRound = (flickeringData: string): void => {
  const resources = [
    { data: STABLE_ICS, url: STABLE_URL },
    { data: flickeringData, url: FLICKERING_URL },
  ];
  davMocks.calendarQuery.mockResolvedValue(
    resources.map((resource) => ({ href: resource.url, props: { getetag: `"${resource.url}"` } })),
  );
  davMocks.fetchCalendarObjects.mockResolvedValue(resources);
};

interface RoundResult {
  added: number;
  removed: number;
}

const createRoundRunner = () => {
  let store: StoredSourceEventState[] = [];

  const runRound = async (): Promise<RoundResult> => {
    const fetcher = createCalDAVSourceFetcher({
      calendarUrl: "https://dav.example.com/cal/",
      password: "password",
      plan: PLAN,
      serverUrl: "https://dav.example.com",
      username: "user",
    });

    const result = await ingestSource({
      calendarId: CALENDAR_ID,
      fetchEvents: () => fetcher.fetchEvents(),
      flush: (changes) => {
        const deleted = new Set(changes.deletes);
        store = [
          ...store.filter((entry) => !deleted.has(entry.id)),
          ...changes.inserts.map((insert) => persistInsert(CALENDAR_ID, insert)),
        ];
        return Promise.resolve();
      },
      readExistingEvents: () => Promise.resolve([...store]),
    });

    return { added: result.eventsAdded, removed: result.eventsRemoved };
  };

  return { runRound };
};

describe("CalDAV ingest with a transiently unreadable resource", () => {
  beforeEach(() => {
    nextRowId = 0;
    vi.clearAllMocks();
    davMocks.fetchCalendars.mockResolvedValue([
      { displayName: "Cal", url: "https://dav.example.com/cal/" },
    ]);
  });

  it("does not delete then re-add events whose resource was transiently unreadable", async () => {
    const { runRound } = createRoundRunner();

    answerRound(FLICKERING_ICS);
    const first = await runRound();
    expect(first.added).toBe(2);
    expect(first.removed).toBe(0);

    // Upstream is unchanged, so the round must fail rather than persist a partial snapshot.
    answerRound("");
    let removedOnUnreadableRound = 0;
    try {
      const second = await runRound();
      removedOnUnreadableRound = second.removed;
    } catch {
      // Failing the round is the safe outcome: the stored state stays intact.
    }
    expect(
      removedOnUnreadableRound,
      "steady-state upstream must never produce removals on a repeat ingest",
    ).toBe(0);

    answerRound(FLICKERING_ICS);
    const third = await runRound();
    expect(
      third.added,
      "a readable-again resource must not be re-added: that is add/remove thrash",
    ).toBe(0);
    expect(third.removed).toBe(0);
  });
});
