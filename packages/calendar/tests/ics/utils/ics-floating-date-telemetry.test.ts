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

const FLOATING_START = [
  "UID:floating@test",
  "DTSTAMP:20260101T000000Z",
  "DTSTART:20260612T090000",
  "DTEND:20260612T100000",
  "SUMMARY:Floating",
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

describe("ICS feeds holding a VEVENT with unanchorable floating dates", () => {
  beforeEach(() => {
    mockPullRemoteCalendar.mockReset();
    mockPrepareCalendarSnapshot.mockReset();
  });

  it("keeps ingesting and reports the event it cannot anchor", async () => {
    const store = createStore();

    const run = await ingestFeed(store, calendar([STANDUP, FLOATING_START, DINNER]));

    expect(run.status).toBe("success");
    expect(run.inserts.toSorted()).toEqual(["state-dinner@test", "state-standup@test"]);
    expect(run.wideEvent["source_events.unsupported_count"]).toBe(1);
    expect(run.wideEvent["source_events.unsupported_uids"]).toBe("floating@test");
  });

  it("applies a real deletion arriving in the same feed", async () => {
    const store = createStore();

    await ingestFeed(store, calendar([STANDUP, DINNER]));
    const second = await ingestFeed(store, calendar([STANDUP, FLOATING_START]));

    expect(second.deletes).toEqual(["state-dinner@test"]);
    expect(store.ids()).toEqual(["state-standup@test"]);
  });

  it("never deletes the stored row of the event it withholds", async () => {
    const store = createStore();
    const feed = calendar([STANDUP, FLOATING_START, DINNER]);

    const statuses: string[] = [];
    for (let poll = 0; poll < 3; poll += 1) {
      const run = await ingestFeed(store, feed);
      statuses.push(run.status);
    }

    expect(statuses).toEqual(["success", "in-sync", "in-sync"]);
    expect(store.ids()).toEqual(["state-dinner@test", "state-standup@test"]);
  });
});
