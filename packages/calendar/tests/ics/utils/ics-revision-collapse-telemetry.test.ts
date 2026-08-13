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

const vevent = (lines: string[]): string[] => ["BEGIN:VEVENT", ...lines, "END:VEVENT"];

const calendar = (events: string[][]): string =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//test//test//EN",
    ...events.flatMap((lines) => vevent(lines)),
    "END:VCALENDAR",
  ].join("\r\n");

const SERIES_MASTER = [
  "UID:weekly@test",
  "DTSTAMP:20260601T000000Z",
  "DTSTART:20260615T090000Z",
  "DTEND:20260615T093000Z",
  "RRULE:FREQ=WEEKLY;COUNT=4",
  "SEQUENCE:0",
  "SUMMARY:Standup",
];

const MOVED_OCCURRENCE = [
  "UID:weekly@test",
  "DTSTAMP:20260601T000000Z",
  "RECURRENCE-ID:20260622T090000Z",
  "DTSTART:20260622T110000Z",
  "DTEND:20260622T113000Z",
  "SEQUENCE:1",
  "SUMMARY:Standup (moved)",
];

const MOVED_OCCURRENCE_MISSING_DTSTART = [
  "UID:weekly@test",
  "DTSTAMP:20260601T000000Z",
  "RECURRENCE-ID:20260622T090000Z",
  "DTEND:20260622T113000Z",
  "SEQUENCE:1",
  "SUMMARY:Standup (moved)",
];

const COLLIDING_UID_LUNCH = [
  "UID:collides@test",
  "DTSTAMP:20260601T000000Z",
  "LAST-MODIFIED:20260601T000000Z",
  "STATUS:CONFIRMED",
  "DTSTART:20260615T120000Z",
  "DTEND:20260615T130000Z",
  "SUMMARY:Lunch",
];

const COLLIDING_UID_REVIEW = [
  "UID:collides@test",
  "DTSTAMP:20260601T000000Z",
  "LAST-MODIFIED:20260601T000000Z",
  "STATUS:CONFIRMED",
  "DTSTART:20260616T140000Z",
  "DTEND:20260616T150000Z",
  "SUMMARY:Review",
];

const storedId = (event: SourceEvent): string =>
  `state-${event.uid}-${event.recurrenceId?.toISOString() ?? "master"}-${event.startTime.toISOString()}`;

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

const ingestFeed = async (
  store: ReturnType<typeof createStore>,
  ical: string,
): Promise<RunOutcome> => {
  mockPullRemoteCalendar.mockResolvedValueOnce({ ical });
  mockPrepareCalendarSnapshot.mockResolvedValueOnce({ changed: false });

  const fetcher = createIcsSourceFetcher(buildConfig());
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

describe("ICS modified occurrence discards", () => {
  beforeEach(() => {
    mockPullRemoteCalendar.mockReset();
    mockPrepareCalendarSnapshot.mockReset();
  });

  it("counts a modified occurrence the publisher stripped DTSTART from", async () => {
    const store = createStore();

    const first = await ingestFeed(store, calendar([SERIES_MASTER, MOVED_OCCURRENCE]));
    expect(first.inserts).toHaveLength(2);
    expect(first.deletes).toEqual([]);

    const second = await ingestFeed(
      store,
      calendar([SERIES_MASTER, MOVED_OCCURRENCE_MISSING_DTSTART]),
    );

    expect(second.deletes).toEqual([
      "state-weekly@test-2026-06-22T09:00:00.000Z-2026-06-22T11:00:00.000Z",
    ]);
    expect(second.wideEvent["events.removed"]).toBe(1);
    expect(discardTotal(second.wideEvent)).toBe(1);
  });

  it("keeps reporting the dropped occurrence on every later run without churn", async () => {
    const store = createStore();

    await ingestFeed(store, calendar([SERIES_MASTER, MOVED_OCCURRENCE]));
    const second = await ingestFeed(
      store,
      calendar([SERIES_MASTER, MOVED_OCCURRENCE_MISSING_DTSTART]),
    );
    const third = await ingestFeed(
      store,
      calendar([SERIES_MASTER, MOVED_OCCURRENCE_MISSING_DTSTART]),
    );
    const fourth = await ingestFeed(
      store,
      calendar([SERIES_MASTER, MOVED_OCCURRENCE_MISSING_DTSTART]),
    );

    expect(second.deletes).toHaveLength(1);
    expect(third.deletes).toEqual([]);
    expect(third.inserts).toEqual([]);
    expect(fourth.deletes).toEqual([]);
    expect(fourth.inserts).toEqual([]);
    expect(store.read()).toHaveLength(1);
    expect(discardTotal(fourth.wideEvent)).toBe(1);
  });
});

describe("ICS colliding-UID discards", () => {
  beforeEach(() => {
    mockPullRemoteCalendar.mockReset();
    mockPrepareCalendarSnapshot.mockReset();
  });

  it("counts the distinct events a publisher collapsed onto one UID", async () => {
    const store = createStore();

    const run = await ingestFeed(
      store,
      calendar([COLLIDING_UID_LUNCH, COLLIDING_UID_REVIEW]),
    );

    expect(run.inserts).toHaveLength(1);
    expect(run.wideEvent["source_events.count"]).toBe(1);
    expect(discardTotal(run.wideEvent)).toBe(1);
  });

  it("does not churn the stored row when the feed reorders the colliding events", async () => {
    const store = createStore();

    const first = await ingestFeed(
      store,
      calendar([COLLIDING_UID_LUNCH, COLLIDING_UID_REVIEW]),
    );
    const second = await ingestFeed(
      store,
      calendar([COLLIDING_UID_REVIEW, COLLIDING_UID_LUNCH]),
    );
    const third = await ingestFeed(
      store,
      calendar([COLLIDING_UID_LUNCH, COLLIDING_UID_REVIEW]),
    );

    expect(first.inserts).toHaveLength(1);
    expect(second.inserts).toEqual([]);
    expect(second.deletes).toEqual([]);
    expect(third.inserts).toEqual([]);
    expect(third.deletes).toEqual([]);
    expect(store.read()).toHaveLength(1);
  });
});

describe("ICS wide-event field size", () => {
  beforeEach(() => {
    mockPullRemoteCalendar.mockReset();
    mockPrepareCalendarSnapshot.mockReset();
  });

  it("keeps the unsupported-uid field loggable when a feed publishes RDATE everywhere", async () => {
    const store = createStore();
    const events = Array.from({ length: 200 }, (_unused, index) => [
      `UID:rdate-${String(index)}-0123456789abcdef@publisher.example.com`,
      "DTSTAMP:20260601T000000Z",
      "DTSTART:20260615T090000Z",
      "DTEND:20260615T093000Z",
      "RDATE:20260616T090000Z",
      "SUMMARY:Shift",
    ]);

    const run = await ingestFeed(store, calendar(events));

    expect(run.wideEvent["source_events.unsupported_count"]).toBe(200);
    const serialized = JSON.stringify(run.wideEvent);
    expect(serialized.length).toBeLessThan(8192);
  });
});
