import { describe, expect, it } from "vitest";
import { generateCalendarFeed } from "../../src/utils/ical-feed";
import type {
  FeedDependencies,
  FeedExclusionCounts,
  FeedResponse,
  StoredFeedEvent,
} from "../../src/utils/ical-feed";
import type { FeedSettings } from "../../src/utils/ical-format";

const NOW = new Date("2026-08-12T12:00:00.000Z");

const createStoredEvent = (
  id: string,
  overrides: Partial<StoredFeedEvent> = {},
): StoredFeedEvent => ({
  availability: "busy",
  calendarId: "calendar-1",
  calendarName: "Work",
  description: null,
  endTime: new Date("2026-08-13T10:00:00.000Z"),
  exceptionDates: null,
  id,
  isAllDay: false,
  location: null,
  recurrenceId: null,
  recurrenceRule: null,
  sourceEventUid: id,
  startTime: new Date("2026-08-13T09:00:00.000Z"),
  startTimeZone: "Etc/UTC",
  title: id,
  ...overrides,
});

const createDependencies = (
  events: StoredFeedEvent[],
  exclusions: FeedExclusionCounts,
  overrides: Partial<FeedDependencies> = {},
): FeedDependencies => ({
  now: NOW,
  readFeedCalendars: () => Promise.resolve([{
    id: "calendar-1",
    syncFutureRange: "2_years",
    syncHistoricRange: "1_month",
  }]),
  readFeedEvents: () => Promise.resolve(events),
  readFeedExclusions: () => Promise.resolve(exclusions),
  readFeedRevision: () => Promise.resolve("revision-1"),
  readFeedSettings: () => Promise.resolve(null),
  resolveUserIdentifier: () => Promise.resolve("user-1"),
  ...overrides,
});

const ALL_DAY_EXCLUDING_SETTINGS: FeedSettings = {
  customEventName: "Busy",
  excludeAllDayEvents: true,
  includeEventDescription: false,
  includeEventLocation: false,
  includeEventName: false,
};

describe("feed withheld counts", () => {
  it("surfaces the exclusion reader's counts on the rendered response", async () => {
    const feed = await generateCalendarFeed("feed-token", createDependencies(
      [createStoredEvent("event-1")],
      { workingElsewhere: 2, workingLocation: 3 },
    ));

    expect(feed?.body).toContain("BEGIN:VEVENT");
    expect(feed?.withheld).toEqual({
      allDay: 0,
      workingElsewhere: 2,
      workingLocation: 3,
    });
  });

  it("counts all-day events the settings withhold from the rendered body", async () => {
    const feed = await generateCalendarFeed("feed-token", createDependencies(
      [
        createStoredEvent("timed-event"),
        createStoredEvent("all-day-event", {
          endTime: new Date("2026-08-14T00:00:00.000Z"),
          isAllDay: true,
          startTime: new Date("2026-08-13T00:00:00.000Z"),
        }),
      ],
      { workingElsewhere: 0, workingLocation: 0 },
      { readFeedSettings: () => Promise.resolve(ALL_DAY_EXCLUDING_SETTINGS) },
    ));

    expect(feed?.withheld).toEqual({
      allDay: 1,
      workingElsewhere: 0,
      workingLocation: 0,
    });
  });

  it("skips the exclusion reader when the caller's validator still matches", async () => {
    const first = await generateCalendarFeed("feed-token", createDependencies(
      [createStoredEvent("event-1")],
      { workingElsewhere: 0, workingLocation: 1 },
    ));

    const unchanged = await generateCalendarFeed("feed-token", createDependencies(
      [createStoredEvent("event-1")],
      { workingElsewhere: 0, workingLocation: 1 },
      {
        readFeedEvents: () => Promise.reject(new Error("must not read events on a match")),
        readFeedExclusions: () => Promise.reject(new Error("must not count exclusions on a match")),
      },
    ), first?.etag ?? null);

    expect(unchanged?.body).toBeNull();
    expect(unchanged?.withheld).toEqual({
      allDay: 0,
      workingElsewhere: 0,
      workingLocation: 0,
    });
  });

  it("reports zero withheld events when no calendars opt into the feed", async () => {
    const feed: FeedResponse | null = await generateCalendarFeed(
      "feed-token",
      createDependencies([], { workingElsewhere: 0, workingLocation: 0 }, {
        readFeedCalendars: () => Promise.resolve([]),
        readFeedEvents: () => Promise.reject(new Error("must not be called")),
        readFeedExclusions: () => Promise.reject(new Error("must not be called")),
        readFeedRevision: () => Promise.reject(new Error("must not be called")),
      }),
    );

    expect(feed?.withheld).toEqual({
      allDay: 0,
      workingElsewhere: 0,
      workingLocation: 0,
    });
  });
});
