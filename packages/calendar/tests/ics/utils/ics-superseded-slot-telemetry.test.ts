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

const REVISED_COPY = [
  "UID:collides@test",
  "DTSTAMP:20260601T000000Z",
  "LAST-MODIFIED:20260601T000000Z",
  "STATUS:CONFIRMED",
  "DTSTART:20260616T120000Z",
  "DTEND:20260616T130000Z",
  "SUMMARY:Lunch",
];

const BARE_COPY = [
  "UID:collides@test",
  "DTSTAMP:20260101T000000Z",
  "DTSTART:20260616T140000Z",
  "DTEND:20260616T150000Z",
  "SUMMARY:Review",
];

const EDITED_LATER_COPY = [
  "UID:twins@test",
  "DTSTAMP:20260601T000000Z",
  "LAST-MODIFIED:20260601T000000Z",
  "STATUS:CONFIRMED",
  "DTSTART:20260618T120000Z",
  "DTEND:20260618T130000Z",
  "SUMMARY:Planning",
];

const EDITED_EARLIER_COPY = [
  "UID:twins@test",
  "DTSTAMP:20260501T000000Z",
  "LAST-MODIFIED:20260501T000000Z",
  "STATUS:CONFIRMED",
  "DTSTART:20260618T160000Z",
  "DTEND:20260618T170000Z",
  "SUMMARY:Retro",
];

const SOLO_EVENT = [
  "UID:solo@test",
  "DTSTAMP:20260601T000000Z",
  "LAST-MODIFIED:20260601T000000Z",
  "STATUS:CONFIRMED",
  "DTSTART:20260617T090000Z",
  "DTEND:20260617T093000Z",
  "SUMMARY:Solo",
];

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

const alternatingCollisionOrder = (poll: number): string[][] => {
  if (poll % 2 === 0) {
    return [BARE_COPY, REVISED_COPY];
  }
  return [REVISED_COPY, BARE_COPY];
};

describe("ICS revision-superseded slot discards", () => {
  beforeEach(() => {
    mockPullRemoteCalendar.mockReset();
    mockPrepareCalendarSnapshot.mockReset();
  });

  it("counts the bare copy a revised namesake supersedes", async () => {
    const store = createStore();

    const run = await ingestFeed(store, calendar([REVISED_COPY, BARE_COPY, SOLO_EVENT]));

    expect(run.wideEvent["source_events.count"]).toBe(2);
    expect(discardTotal(run.wideEvent)).toBe(1);
  });

  it("drops the same copy whichever order the feed lists the pair in", async () => {
    const forward = createStore();
    const reversed = createStore();

    const first = await ingestFeed(forward, calendar([REVISED_COPY, BARE_COPY]));
    const second = await ingestFeed(reversed, calendar([BARE_COPY, REVISED_COPY]));

    expect(first.inserts).toEqual(second.inserts);
  });

  it("counts the older of two revised copies that collide on one UID", async () => {
    const store = createStore();

    const run = await ingestFeed(
      store,
      calendar([EDITED_LATER_COPY, EDITED_EARLIER_COPY, SOLO_EVENT]),
    );

    expect(run.wideEvent["source_events.count"]).toBe(2);
    expect(discardTotal(run.wideEvent)).toBe(1);
  });

  it("settles without churning the surviving row over repeated polls", async () => {
    const store = createStore();

    const first = await ingestFeed(store, calendar([REVISED_COPY, BARE_COPY]));
    expect(first.inserts).toHaveLength(1);

    for (let poll = 0; poll < 3; poll += 1) {
      const repeat = await ingestFeed(
        store,
        calendar(alternatingCollisionOrder(poll)),
      );
      expect(repeat.inserts).toEqual([]);
      expect(repeat.deletes).toEqual([]);
    }

    expect(store.ids()).toEqual(["state-collides@test-2026-06-16T12:00:00.000Z"]);
  });
});
