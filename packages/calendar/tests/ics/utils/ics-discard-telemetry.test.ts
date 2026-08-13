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

const HEALTHY_EVENT = [
  "UID:standup@test",
  "DTSTAMP:20260517T000000Z",
  "DTSTART:20260617T120000Z",
  "DTEND:20260617T130000Z",
  "SUMMARY:Standup",
];

const DINNER_EVENT = [
  "UID:dinner@test",
  "DTSTAMP:20260517T000000Z",
  "DTSTART:20260618T180000Z",
  "DTEND:20260618T190000Z",
  "SUMMARY:Dinner",
];

const DINNER_EVENT_MISSING_DTSTART = [
  "UID:dinner@test",
  "DTSTAMP:20260517T000000Z",
  "DTEND:20260618T190000Z",
  "SUMMARY:Dinner",
];

const DINNER_EVENT_MISSING_UID = [
  "DTSTAMP:20260517T000000Z",
  "DTSTART:20260618T180000Z",
  "DTEND:20260618T190000Z",
  "SUMMARY:Dinner",
];

const toStoredState = (event: SourceEvent): StoredSourceEventState => ({
  availability: event.availability ?? null,
  description: event.description ?? null,
  endTime: event.endTime,
  exceptionDates: null,
  id: `state-${event.uid}`,
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
    read: (): StoredSourceEventState[] => rows,
    apply: (inserts: SourceEvent[], deletes: string[]): void => {
      const removed = new Set(deletes);
      rows = [
        ...rows.filter((row) => !removed.has(row.id)),
        ...inserts
          .map((event) => toStoredState(event))
          .filter((row) => !rows.some((existing) => existing.id === row.id)),
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
      outcome.inserts.push(...changes.inserts.map(({ uid }) => uid));
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

describe("ICS feed discards", () => {
  beforeEach(() => {
    mockPullRemoteCalendar.mockReset();
    mockPrepareCalendarSnapshot.mockReset();
  });

  it("counts an event the feed publisher stripped DTSTART from before deleting it", async () => {
    const store = createStore();

    const first = await ingestFeed(store, calendar([HEALTHY_EVENT, DINNER_EVENT]));
    expect(first.inserts.toSorted()).toEqual(["dinner@test", "standup@test"]);
    expect(first.deletes).toEqual([]);

    const second = await ingestFeed(
      store,
      calendar([HEALTHY_EVENT, DINNER_EVENT_MISSING_DTSTART]),
    );

    expect(second.deletes).toEqual(["state-dinner@test"]);
    expect(second.wideEvent["events.removed"]).toBe(1);
    expect(discardTotal(second.wideEvent)).toBe(1);
  });

  it("counts an event the feed publisher stripped UID from before deleting it", async () => {
    const store = createStore();

    await ingestFeed(store, calendar([HEALTHY_EVENT, DINNER_EVENT]));
    const second = await ingestFeed(
      store,
      calendar([HEALTHY_EVENT, DINNER_EVENT_MISSING_UID]),
    );

    expect(second.deletes).toEqual(["state-dinner@test"]);
    expect(discardTotal(second.wideEvent)).toBe(1);
  });

  it("keeps reporting the discard on every later run and never churns the row", async () => {
    const store = createStore();

    await ingestFeed(store, calendar([HEALTHY_EVENT, DINNER_EVENT]));
    const second = await ingestFeed(
      store,
      calendar([HEALTHY_EVENT, DINNER_EVENT_MISSING_DTSTART]),
    );
    const third = await ingestFeed(
      store,
      calendar([HEALTHY_EVENT, DINNER_EVENT_MISSING_DTSTART]),
    );
    const fourth = await ingestFeed(
      store,
      calendar([HEALTHY_EVENT, DINNER_EVENT_MISSING_DTSTART]),
    );

    expect(second.deletes).toEqual(["state-dinner@test"]);
    expect(third.deletes).toEqual([]);
    expect(third.inserts).toEqual([]);
    expect(fourth.deletes).toEqual([]);
    expect(fourth.inserts).toEqual([]);
    expect(store.read().map(({ id }) => id)).toEqual(["state-standup@test"]);

    expect(discardTotal(third.wideEvent)).toBe(1);
    expect(discardTotal(fourth.wideEvent)).toBe(1);
  });

  it("reports a clean feed as having discarded nothing", async () => {
    const store = createStore();

    const run = await ingestFeed(store, calendar([HEALTHY_EVENT, DINNER_EVENT]));

    expect(discardTotal(run.wideEvent)).toBe(0);
    expect(run.wideEvent["source_events.count"]).toBe(2);
  });
});
