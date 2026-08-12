import { generateCalendarFeed } from "../../src/utils/ical-feed";
import type { StoredFeedEvent } from "../../src/utils/ical-feed";
import type { CalendarEvent, FeedSettings } from "../../src/utils/ical-format";

/* Wide enough that a fixture's dates never fall outside the feed's horizon. */
const FEED_CALENDAR = {
  id: "calendar-1",
  syncFutureRange: "2_years",
  syncHistoricRange: "2_years",
};

const NOW = new Date("2026-06-01T00:00:00.000Z");

interface FeedScope {
  feedId: string;
}

const serializeStoredField = (value: unknown): string | null => {
  if (value === null) {
    return null;
  }
  return JSON.stringify(value);
};

const toStoredFeedEvent = (event: CalendarEvent): StoredFeedEvent => ({
  ...event,
  exceptionDates: serializeStoredField(event.exceptionDates),
  recurrenceRule: serializeStoredField(event.recurrenceRule),
});

interface RenderFeedInput {
  settings: FeedSettings;
  calendarIds: string[];
  events: CalendarEvent[];
  onLoadEvents?: (calendarIds: string[]) => void;
}

const renderFeed = async ({
  calendarIds,
  events,
  onLoadEvents,
  settings,
}: RenderFeedInput): Promise<string> => {
  const response = await generateCalendarFeed<FeedScope>("feed-token", {
    now: NOW,
    resolveFeed: () => Promise.resolve({ scope: { feedId: "feed-1" }, settings }),
    readFeedCalendars: () =>
      Promise.resolve(calendarIds.map((id) => ({ ...FEED_CALENDAR, id }))),
    readFeedEvents: (selected) => {
      onLoadEvents?.(selected);
      return Promise.resolve(
        events
          .filter(({ calendarId }) => selected.includes(calendarId))
          .map((event) => toStoredFeedEvent(event)),
      );
    },
    readFeedExclusions: () => Promise.resolve({ workingElsewhere: 0, workingLocation: 0 }),
    readFeedRevision: () => Promise.resolve("revision-1"),
  });

  const body = response?.body ?? null;

  if (body === null) {
    throw new Error("Feed fixture rendered no body");
  }

  return body;
};

export { renderFeed };
