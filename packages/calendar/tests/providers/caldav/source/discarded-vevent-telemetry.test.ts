import { beforeEach, describe, expect, it, vi } from "vitest";
import { ingestSource } from "../../../../src/core/sync-engine/ingest";
import type {
  IngestWideEventFields,
  IngestionChanges,
} from "../../../../src/core/sync-engine/ingest";
import type { StoredSourceEventState } from "../../../../src/core/source/stored-event-state";
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

const wrap = (veventLines: string[]): string => [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//keeper.sh//test//EN",
  "BEGIN:VEVENT",
  ...veventLines,
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const HEALTHY_RESOURCE = wrap([
  "UID:standup@example.com",
  "DTSTAMP:20260601T000000Z",
  "DTSTART:20260620T090000Z",
  "DTEND:20260620T100000Z",
  "SUMMARY:Standup",
]);

const DINNER_RESOURCE = wrap([
  "UID:dinner@example.com",
  "DTSTAMP:20260601T000000Z",
  "DTSTART:20260621T180000Z",
  "DTEND:20260621T190000Z",
  "SUMMARY:Dinner",
]);

const DINNER_RESOURCE_MISSING_DTSTART = wrap([
  "UID:dinner@example.com",
  "DTSTAMP:20260601T000000Z",
  "DTEND:20260621T190000Z",
  "SUMMARY:Dinner",
]);

const answerWith = (resources: string[]): void => {
  const hrefs = resources.map(
    (_unused, index) => `${CALENDAR_PATH}event-${String(index)}.ics`,
  );
  davMocks.calendarQuery.mockResolvedValue(hrefs.map((href) => ({ href })));
  davMocks.fetchCalendarObjects.mockResolvedValue(
    resources.map((data, index) => ({ data, url: `${SERVER_URL}${hrefs[index]}` })),
  );
};

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

const runIngest = async (
  stored: StoredSourceEventState[],
): Promise<{ changes: IngestionChanges[]; wideEvent: IngestWideEventFields }> => {
  const fetcher = createCalDAVSourceFetcher({
    calendarUrl: `${SERVER_URL}${CALENDAR_PATH}`,
    password: "pass",
    plan: PLAN,
    serverUrl: SERVER_URL,
    username: "user",
  });
  const changes: IngestionChanges[] = [];
  let wideEvent: IngestWideEventFields = {};
  let remaining = stored;

  await ingestSource({
    calendarId: CALENDAR_ID,
    fetchEvents: () => fetcher.fetchEvents(),
    flush: (change) => {
      changes.push(change);
      const deleted = new Set(change.deletes);
      remaining = remaining.filter((event) => !deleted.has(event.id));
      return Promise.resolve();
    },
    onIngestEvent: (event) => {
      wideEvent = { ...event };
    },
    readExistingEvents: () => Promise.resolve(remaining),
  });

  return { changes, wideEvent };
};

describe("CalDAV VEVENT-level discards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    davMocks.fetchCalendars.mockResolvedValue([]);
  });

  it("counts a readable resource whose VEVENT the parser could not build", async () => {
    answerWith([HEALTHY_RESOURCE, DINNER_RESOURCE_MISSING_DTSTART]);

    const run = await runIngest([
      storedEvent({ id: "state-standup", sourceEventUid: "standup@example.com" }),
      storedEvent({
        endTime: new Date("2026-06-21T19:00:00.000Z"),
        id: "state-dinner",
        sourceEventUid: "dinner@example.com",
        startTime: new Date("2026-06-21T18:00:00.000Z"),
      }),
    ]);

    expect(run.changes[0]?.deletes).toEqual(["state-dinner"]);
    expect(run.wideEvent["source_events.skipped_resources"]).toBeUndefined();
    expect(discardTotal(run.wideEvent)).toBe(1);
  });

  it("reports nothing discarded when every VEVENT parsed", async () => {
    answerWith([HEALTHY_RESOURCE, DINNER_RESOURCE]);

    const run = await runIngest([
      storedEvent({ id: "state-standup", sourceEventUid: "standup@example.com" }),
      storedEvent({
        endTime: new Date("2026-06-21T19:00:00.000Z"),
        id: "state-dinner",
        sourceEventUid: "dinner@example.com",
        startTime: new Date("2026-06-21T18:00:00.000Z"),
      }),
    ]);

    expect(run.changes[0]?.deletes ?? []).toEqual([]);
    expect(discardTotal(run.wideEvent)).toBe(0);
  });
});
