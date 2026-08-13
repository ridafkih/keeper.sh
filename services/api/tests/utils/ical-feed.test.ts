import { describe, expect, it } from "vitest";
import { createIcalFeedQuery, generateCalendarFeed } from "../../src/utils/ical-feed";
import type { FeedResponse, IcalFeedQuery, StoredFeedEvent } from "../../src/utils/ical-feed";

const NOW = new Date("2026-08-12T12:00:00.000Z");
const MS_PER_DAY = 86_400_000;

const shiftDays = (days: number): Date => new Date(NOW.getTime() + days * MS_PER_DAY);

const createStoredEvent = (
  id: string,
  startTime: Date,
  overrides: Partial<StoredFeedEvent> = {},
): StoredFeedEvent => ({
  availability: "busy",
  calendarId: "calendar-1",
  calendarName: "Work",
  description: null,
  endTime: new Date(startTime.getTime() + 3_600_000),
  exceptionDates: null,
  id,
  isAllDay: false,
  location: null,
  recurrenceId: null,
  recurrenceRule: null,
  sourceEventUid: id,
  startTime,
  startTimeZone: "Etc/UTC",
  title: id,
  ...overrides,
});

/** Stands in for the SQL the feed reader issues, so a query that fails to bound
 *  the read produces the same oversized feed the database would return. */
const createReader = (events: StoredFeedEvent[]) =>
  (_calendarIds: string[], query: IcalFeedQuery): Promise<StoredFeedEvent[]> => {
    const withinWindow = events.filter((event) =>
      event.startTime <= query.windowEnd
      && (event.endTime >= query.windowStart || event.recurrenceRule !== null));
    const ordered = withinWindow.toSorted((first, second) =>
      first.startTime.getTime() - second.startTime.getTime());
    return Promise.resolve(ordered);
  };

/* Stands in for the digest Postgres computes over the rows the feed would render. */
const createRevisionReader = (events: StoredFeedEvent[]) =>
  (_calendarIds: string[], query: IcalFeedQuery): Promise<string> =>
    createReader(events)(_calendarIds, query).then((rows) =>
      rows.map((row) => `${row.id}:${row.startTime.toISOString()}:${row.title ?? ""}`).join("|"));

const responseFor = (
  events: StoredFeedEvent[],
  ifNoneMatch: string | null = null,
): Promise<FeedResponse | null> =>
  generateCalendarFeed("feed-token", {
    now: NOW,
    readFeedCalendars: () => Promise.resolve([{
      id: "calendar-1",
      syncFutureRange: "2_years",
      syncHistoricRange: "1_month",
    }]),
    readFeedEvents: createReader(events),
    readFeedExclusions: () => Promise.resolve({ workingElsewhere: 0, workingLocation: 0 }),
    readFeedRevision: createRevisionReader(events),
    readFeedSettings: () => Promise.resolve(null),
    resolveUserIdentifier: () => Promise.resolve("user-1"),
  }, ifNoneMatch);

const feedFor = async (events: StoredFeedEvent[]): Promise<string | null> => {
  const response = await responseFor(events);
  return response?.body ?? null;
};

describe("createIcalFeedQuery", () => {
  it("falls back to the default horizon when no calendar configures a wider one", () => {
    const query = createIcalFeedQuery([{
      id: "calendar-1",
      syncFutureRange: "2_years",
      syncHistoricRange: "1_month",
    }], NOW);

    expect(query.windowStart.getTime()).toBeLessThan(NOW.getTime());
    expect(query.windowEnd.getTime()).toBeGreaterThan(shiftDays(700).getTime());
  });

  /*
   * A hardcoded horizon cut history the user deliberately kept: stored events
   * reach as far back as the widest range configured on any feed calendar.
   */
  it("reaches back as far as the widest historic range across the feed", () => {
    const narrow = createIcalFeedQuery([{
      id: "calendar-1",
      syncFutureRange: "2_years",
      syncHistoricRange: "1_month",
    }], NOW);
    const widest = createIcalFeedQuery([
      { id: "calendar-1", syncFutureRange: "2_years", syncHistoricRange: "1_month" },
      { id: "calendar-2", syncFutureRange: "2_years", syncHistoricRange: "2_years" },
    ], NOW);

    expect(widest.windowStart.getTime()).toBeLessThan(narrow.windowStart.getTime());
    expect(widest.windowStart.getTime()).toBeLessThan(shiftDays(-700).getTime());
  });

  /*
   * A check constraint pins the stored range to the enum, so an unrecognised
   * value means that constraint is already broken. Substituting a default would
   * publish a silently wrong horizon and hide it.
   */
  it("throws on a stored range outside the enum", () => {
    expect(() => createIcalFeedQuery([{
      id: "calendar-1",
      syncFutureRange: "forever",
      syncHistoricRange: "9_years",
    }], NOW)).toThrow("calendar-1");
  });
});

describe("generateCalendarFeed", () => {
  it("returns null for an unknown identifier", async () => {
    const feed = await generateCalendarFeed("feed-token", {
      now: NOW,
      readFeedCalendars: () => Promise.reject(new Error("must not be called")),
      readFeedEvents: () => Promise.reject(new Error("must not be called")),
      readFeedExclusions: () => Promise.reject(new Error("must not be called")),
      readFeedRevision: () => Promise.reject(new Error("must not be called")),
      readFeedSettings: () => Promise.reject(new Error("must not be called")),
      resolveUserIdentifier: () => Promise.resolve(null),
    });

    expect(feed).toBeNull();
  });

  it("drops events older than the feed horizon while keeping recent history", async () => {
    const feed = await feedFor([
      createStoredEvent("ancient", shiftDays(-1500)),
      createStoredEvent("recent-history", shiftDays(-30)),
    ]);

    expect(feed).not.toContain("ancient");
    expect(feed).toContain("recent-history");
  });

  it("drops events beyond the feed horizon", async () => {
    const feed = await feedFor([
      createStoredEvent("upcoming", shiftDays(30)),
      createStoredEvent("distant", shiftDays(2000)),
    ]);

    expect(feed).toContain("upcoming");
    expect(feed).not.toContain("distant");
  });

  it("keeps a long-running series whose first occurrence predates the horizon", async () => {
    const feed = await feedFor([
      createStoredEvent("weekly-standup", shiftDays(-1500), {
        recurrenceRule: JSON.stringify({ frequency: "WEEKLY", interval: 1 }),
      }),
    ]);

    expect(feed).toContain("weekly-standup");
  });

  /*
   * The window reaches as far back as the widest configured range, so a busy
   * calendar can hold far more past events than upcoming ones. Any cap applied in
   * start order would spend itself on history and publish a feed that stops
   * before today, so the feed stays uncapped and this holds that line.
   */
  it("publishes upcoming events on a calendar dominated by history", async () => {
    const past = Array.from({ length: 5000 }, (_value, index) =>
      createStoredEvent(`past-${index}`, new Date(NOW.getTime() - (index + 1) * 60_000)));
    const upcoming = Array.from({ length: 5 }, (_value, index) =>
      createStoredEvent(`upcoming-${index}`, new Date(NOW.getTime() + (index + 1) * 60_000)));

    const feed = await feedFor([...past, ...upcoming]);

    for (const index of [0, 1, 2, 3, 4]) {
      expect(feed).toContain(`upcoming-${index}`);
    }
  }, 30_000);

  it("skips reading events when the caller's validator still matches", async () => {
    const events = [createStoredEvent("event-1", shiftDays(1))];
    const { etag } = await responseFor(events) ?? {};

    const unchanged = await generateCalendarFeed("feed-token", {
      now: NOW,
      readFeedCalendars: () => Promise.resolve([{
        id: "calendar-1",
        syncFutureRange: "2_years",
        syncHistoricRange: "1_month",
      }]),
      readFeedEvents: () => Promise.reject(new Error("must not read events on a match")),
      readFeedExclusions: () => Promise.reject(new Error("must not count exclusions on a match")),
      readFeedRevision: createRevisionReader(events),
      readFeedSettings: () => Promise.resolve(null),
      resolveUserIdentifier: () => Promise.resolve("user-1"),
    }, etag ?? null);

    expect(unchanged?.body).toBeNull();
    expect(unchanged?.etag).toBe(etag);
  });

  it("changes the validator when an event changes", async () => {
    const before = await responseFor([createStoredEvent("event-1", shiftDays(1))]);
    const after = await responseFor([createStoredEvent("event-1", shiftDays(2))]);

    expect(after?.etag).not.toBe(before?.etag);
  });

  it("renders an empty calendar when no calendars opt into the feed", async () => {
    const feed = await generateCalendarFeed("feed-token", {
      now: NOW,
      readFeedCalendars: () => Promise.resolve([]),
      readFeedEvents: () => Promise.reject(new Error("must not be called")),
      readFeedExclusions: () => Promise.reject(new Error("must not be called")),
      readFeedRevision: () => Promise.reject(new Error("must not be called")),
      readFeedSettings: () => Promise.resolve(null),
      resolveUserIdentifier: () => Promise.resolve("user-1"),
    });

    expect(feed?.body).toContain("BEGIN:VCALENDAR");
    expect(feed?.body).not.toContain("BEGIN:VEVENT");
  });
});
