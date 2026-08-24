import { beforeEach, describe, expect, it, vi } from "vitest";
import { ingestSource } from "../../../src/core/sync-engine/ingest";
import type { IngestWideEventFields } from "../../../src/core/sync-engine/ingest";
import type { StoredSourceEventState } from "../../../src/core/source/stored-event-state";
import type { SourceEvent } from "../../../src/core/types";
import { createIcsSourceFetcher } from "../../../src/ics/utils/fetch-adapter";
import { parseIcsCalendar } from "../../../src/ics/utils/parse-ics-calendar";
import { parseIcsEventsWithDiagnostics } from "../../../src/ics/utils/parse-ics-events";

const { mockPullRemoteCalendar } = vi.hoisted(() => ({
  mockPullRemoteCalendar: vi.fn<(...args: unknown[]) => Promise<{ ical: string }>>(),
}));
const { mockPrepareCalendarSnapshot } = vi.hoisted(() => ({
  mockPrepareCalendarSnapshot: vi.fn<(...args: unknown[]) => Promise<{ changed: boolean }>>(),
}));

vi.mock("../../../src/ics/utils/pull-remote-calendar", () => ({
  pullRemoteCalendar: mockPullRemoteCalendar,
}));
vi.mock("../../../src/ics/utils/create-snapshot", () => ({
  prepareCalendarSnapshot: mockPrepareCalendarSnapshot,
}));

const CALENDAR_ID = "ics-calendar";

const vevent = (lines: string[]): string[] => ["BEGIN:VEVENT", ...lines, "END:VEVENT"];

const icsString = (events: string[][]): string =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//test//test//EN",
    ...events.flatMap((lines) => vevent(lines)),
    "END:VCALENDAR",
  ].join("\r\n");

const calendar = (events: string[][]) =>
  parseIcsCalendar({ icsString: icsString(events) });

const OLD_REVISION = [
  "UID:mtg@test",
  "DTSTAMP:20260601T000000Z",
  "DTSTART:20260610T100000Z",
  "DTEND:20260610T110000Z",
  "SEQUENCE:1",
  "SUMMARY:Meeting",
];

const MANGLED_NEW_REVISION = [
  "UID:mtg@test",
  "DTSTAMP:20260601T000000Z",
  "DTSTART:20260610T140000Z",
  "DURATION:-PT1H",
  "SEQUENCE:2",
  "SUMMARY:Meeting",
];

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
    read: (): StoredSourceEventState[] => rows,
    startTimes: (): string[] => rows.map((row) => row.startTime.toISOString()).toSorted(),
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

describe("a feed whose newest revision is unbuildable leaves a trace on the wide event", () => {
  beforeEach(() => {
    mockPullRemoteCalendar.mockReset();
    mockPrepareCalendarSnapshot.mockReset();
  });

  it("never reverts a stored event to the time the publisher moved it away from", async () => {
    const store = createStore();

    const first = await ingestFeed(store, icsString([OLD_REVISION]));
    expect(first.inserts).toEqual(["state-mtg@test"]);
    expect(store.startTimes()).toEqual(["2026-06-10T10:00:00.000Z"]);

    const second = await ingestFeed(store, icsString([OLD_REVISION, MANGLED_NEW_REVISION]));

    expect(second.deletes).toEqual([]);
    expect(second.inserts).toEqual([]);
    expect(store.startTimes()).toEqual(["2026-06-10T10:00:00.000Z"]);
    expect(second.wideEvent["source_events.unsupported_uids"]).toBe("mtg@test");
    expect(second.wideEvent["source_events.unsupported_count"]).toBe(1);
    expect(second.wideEvent["source_events.discarded_unrepresentable"]).toBe(1);
  });
});

describe("an unbuildable newest revision never leaves a stale time behind", () => {
  it("withholds the UID when a negative duration supersedes a buildable revision", () => {
    const parsed = parseIcsEventsWithDiagnostics(calendar([
      OLD_REVISION,
      [
        "UID:mtg@test",
        "DTSTAMP:20260601T000000Z",
        "DTSTART:20260610T140000Z",
        "DURATION:-PT1H",
        "SEQUENCE:2",
        "SUMMARY:Meeting",
      ],
    ]));

    expect(parsed.unsupportedEvents.map(({ uid }) => uid)).toEqual(["mtg@test"]);
    expect(parsed.unrepresentableCount).toBe(1);
    expect(parsed.events.map(({ startTime }) => startTime.toISOString())).toEqual([
      "2026-06-10T10:00:00.000Z",
    ]);
  });

  it("withholds the UID when an hour-duration all-day supersedes a buildable revision", () => {
    const parsed = parseIcsEventsWithDiagnostics(calendar([
      OLD_REVISION,
      [
        "UID:mtg@test",
        "DTSTAMP:20260601T000000Z",
        "DTSTART;VALUE=DATE:20260612",
        "DURATION:PT1H",
        "SEQUENCE:2",
        "SUMMARY:Meeting",
      ],
    ]));

    expect(parsed.unsupportedEvents.map(({ uid }) => uid)).toEqual(["mtg@test"]);
    expect(parsed.unrepresentableCount).toBe(1);
  });

  it("withholds a modified occurrence's UID when its newest revision is unbuildable", () => {
    const parsed = parseIcsEventsWithDiagnostics(calendar([
      [
        "UID:weekly@test",
        "DTSTAMP:20260601T000000Z",
        "DTSTART:20260615T090000Z",
        "DTEND:20260615T093000Z",
        "RRULE:FREQ=WEEKLY;COUNT=4",
        "SEQUENCE:0",
        "SUMMARY:Standup",
      ],
      [
        "UID:weekly@test",
        "DTSTAMP:20260601T000000Z",
        "RECURRENCE-ID:20260622T090000Z",
        "DTSTART:20260622T110000Z",
        "DTEND:20260622T113000Z",
        "SEQUENCE:1",
        "SUMMARY:Standup (moved)",
      ],
      [
        "UID:weekly@test",
        "DTSTAMP:20260601T000000Z",
        "RECURRENCE-ID:20260622T090000Z",
        "DTSTART:20260622T150000Z",
        "DURATION:-PT30M",
        "SEQUENCE:2",
        "SUMMARY:Standup (moved again)",
      ],
    ]));

    expect(parsed.unsupportedEvents.map(({ uid }) => uid)).toEqual(["weekly@test"]);
    expect(parsed.unrepresentableCount).toBe(1);
  });

  it("still counts an unbuildable revision that loses to a newer buildable one exactly once", () => {
    const parsed = parseIcsEventsWithDiagnostics(calendar([
      [
        "UID:mtg@test",
        "DTSTAMP:20260601T000000Z",
        "DTSTART:20260610T100000Z",
        "DURATION:-PT1H",
        "SEQUENCE:1",
        "SUMMARY:Meeting",
      ],
      [
        "UID:mtg@test",
        "DTSTAMP:20260601T000000Z",
        "DTSTART:20260610T140000Z",
        "DTEND:20260610T150000Z",
        "SEQUENCE:2",
        "SUMMARY:Meeting",
      ],
    ]));

    expect(parsed.unsupportedEvents).toEqual([]);
    expect(parsed.events.map(({ startTime }) => startTime.toISOString())).toEqual([
      "2026-06-10T14:00:00.000Z",
    ]);
  });

  it("leaves a lone unbuildable VEVENT counted and unwithheld", () => {
    const parsed = parseIcsEventsWithDiagnostics(calendar([
      [
        "UID:solo@test",
        "DTSTAMP:20260601T000000Z",
        "DTSTART:20260610T100000Z",
        "DURATION:-PT1H",
        "SEQUENCE:1",
        "SUMMARY:Solo",
      ],
    ]));

    expect(parsed.unsupportedEvents).toEqual([]);
    expect(parsed.unrepresentableCount).toBe(1);
    expect(parsed.events).toEqual([]);
  });
});
