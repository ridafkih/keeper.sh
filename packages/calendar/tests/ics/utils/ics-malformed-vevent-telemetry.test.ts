import { beforeEach, describe, expect, it, vi } from "vitest";
import { ingestSource } from "../../../src/core/sync-engine/ingest";
import type { IngestWideEventFields } from "../../../src/core/sync-engine/ingest";
import type { StoredSourceEventState } from "../../../src/core/source/stored-event-state";
import type { SourceEvent } from "../../../src/core/types";
import { createIcsSourceFetcher } from "../../../src/ics/utils/fetch-adapter";

const { mockPullRemoteCalendar } = vi.hoisted(() => ({
  mockPullRemoteCalendar: vi.fn<(...args: unknown[]) => Promise<{ ical: string }>>(),
}));
const { mockPrepareCalendarSnapshot } = vi.hoisted(() => ({
  mockPrepareCalendarSnapshot: vi.fn<(...args: unknown[]) => Promise<{
    changed: boolean;
    snapshot?: { contentHash: string; ical: string };
  }>>(),
}));

vi.mock("../../../src/ics/utils/pull-remote-calendar", () => ({
  pullRemoteCalendar: mockPullRemoteCalendar,
}));
vi.mock("../../../src/ics/utils/create-snapshot", () => ({
  prepareCalendarSnapshot: mockPrepareCalendarSnapshot,
}));

const CALENDAR_ID = "ics-calendar";

const buildConfig = () => ({
  calendarId: CALENDAR_ID,
  url: "https://example.com/calendar.ics",
  database: {} as never,
  plan: {
    futureRange: "2_years" as const,
    historicRange: "1_week" as const,
    window: {
      timeMin: new Date("2026-01-01T00:00:00.000Z"),
      timeMax: new Date("2027-01-01T00:00:00.000Z"),
    },
  },
});

const calendar = (events: string[][]): string =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//test//test//EN",
    ...events.flatMap((lines) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"]),
    "END:VCALENDAR",
  ].join("\r\n");

const STANDUP = [
  "UID:standup@test",
  "DTSTAMP:20260101T000000Z",
  "DTSTART:20260610T090000Z",
  "DTEND:20260610T093000Z",
  "SUMMARY:Standup",
];

const DINNER = [
  "UID:dinner@test",
  "DTSTAMP:20260101T000000Z",
  "DTSTART:20260610T190000Z",
  "DTEND:20260610T203000Z",
  "SUMMARY:Dinner",
];

// RFC 5545 wants a day or week DURATION beside a DATE-valued DTSTART.
const ALL_DAY_HOUR_DURATION = [
  "UID:offsite@test",
  "DTSTAMP:20260101T000000Z",
  "DTSTART;VALUE=DATE:20260615",
  "DURATION:PT24H",
  "SUMMARY:Offsite",
];

const NEGATIVE_DURATION = [
  "UID:backwards@test",
  "DTSTAMP:20260101T000000Z",
  "DTSTART:20260611T090000Z",
  "DURATION:-PT1H",
  "SUMMARY:Backwards",
];

const RANGED_OVERRIDE = [
  "UID:series@test",
  "DTSTAMP:20260101T000000Z",
  "RECURRENCE-ID;RANGE=THISANDFUTURE:20260612T090000Z",
  "DTSTART:20260612T100000Z",
  "DTEND:20260612T110000Z",
  "SUMMARY:Moved from here on",
];

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

const ingestFeed = async (
  store: ReturnType<typeof createStore>,
  ical: string,
): Promise<RunOutcome> => {
  mockPullRemoteCalendar.mockResolvedValueOnce({ ical });
  mockPrepareCalendarSnapshot.mockResolvedValueOnce({ changed: false });

  const fetcher = createIcsSourceFetcher(buildConfig());
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

describe("ICS feeds holding a VEVENT the parser cannot build", () => {
  beforeEach(() => {
    mockPullRemoteCalendar.mockReset();
    mockPrepareCalendarSnapshot.mockReset();
  });

  it("ingests the healthy control feed with no discards", async () => {
    const store = createStore();

    const run = await ingestFeed(store, calendar([STANDUP, DINNER]));

    expect(run.status).toBe("success");
    expect(run.inserts.toSorted()).toEqual(["state-dinner@test", "state-standup@test"]);
    expect(discardTotal(run.wideEvent)).toBe(0);
  });

  it("keeps ingesting when one all-day VEVENT declares an hour-based DURATION", async () => {
    const store = createStore();

    const run = await ingestFeed(
      store,
      calendar([STANDUP, ALL_DAY_HOUR_DURATION, DINNER]),
    );

    expect(run.status).toBe("success");
    expect(run.inserts.toSorted()).toEqual(["state-dinner@test", "state-standup@test"]);
    expect(discardTotal(run.wideEvent)).toBe(1);
  });

  it("keeps ingesting when one VEVENT declares a negative DURATION", async () => {
    const store = createStore();

    const run = await ingestFeed(store, calendar([STANDUP, NEGATIVE_DURATION, DINNER]));

    expect(run.status).toBe("success");
    expect(run.inserts.toSorted()).toEqual(["state-dinner@test", "state-standup@test"]);
    expect(discardTotal(run.wideEvent)).toBe(1);
  });

  it("keeps ingesting when one VEVENT carries a THISANDFUTURE override", async () => {
    const store = createStore();

    const run = await ingestFeed(store, calendar([STANDUP, RANGED_OVERRIDE, DINNER]));

    expect(run.status).toBe("success");
    expect(run.inserts.toSorted()).toEqual(["state-dinner@test", "state-standup@test"]);
    expect(discardTotal(run.wideEvent)).toBe(1);
  });

  it("applies a real deletion that arrives in the same feed as a malformed VEVENT", async () => {
    const store = createStore();

    const first = await ingestFeed(store, calendar([STANDUP, DINNER]));
    expect(first.status).toBe("success");
    expect(store.ids()).toEqual(["state-dinner@test", "state-standup@test"]);

    const second = await ingestFeed(
      store,
      calendar([STANDUP, ALL_DAY_HOUR_DURATION]),
    );

    expect(second.deletes).toEqual(["state-dinner@test"]);
    expect(store.ids()).toEqual(["state-standup@test"]);
  });

  it("converges over repeated polls of the same malformed feed", async () => {
    const store = createStore();
    const feed = calendar([STANDUP, ALL_DAY_HOUR_DURATION, DINNER]);

    const statuses: string[] = [];
    for (let poll = 0; poll < 3; poll += 1) {
      const run = await ingestFeed(store, feed);
      statuses.push(run.status);
    }

    expect(statuses).toEqual(["success", "in-sync", "in-sync"]);
    expect(store.ids()).toEqual(["state-dinner@test", "state-standup@test"]);
  });
});
