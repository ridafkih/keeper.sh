import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_FEED_SETTINGS } from "@keeper.sh/data-schemas";
import { renderFeed } from "../fixtures/render-feed";
import { formatEventsAsIcal } from "../../src/utils/ical-format";
import type { FeedSettings } from "../../src/utils/ical-format";
import {
  LEGACY_FEED_CALENDAR_IDS,
  LEGACY_FEED_EVENTS,
  LEGACY_FEED_SETTINGS,
  makeFeedEvent,
} from "../fixtures/legacy-feed-events";
import type { FeedEvent } from "../fixtures/legacy-feed-events";

interface ResolvedFeedSettings {
  includeEventName: boolean;
  includeEventDescription: boolean;
  includeEventLocation: boolean;
  excludeAllDayEvents: boolean;
  excludeFocusTime: boolean;
  excludeOutOfOffice: boolean;
  customEventName: string;
}

let goldenFeed = "";

const normalizeIcs = (ics: string): string =>
  ics.replaceAll(/DTSTAMP:[0-9TZ]+/g, "DTSTAMP:X").replaceAll("\r\n", "\n").trim();

const BACKFILLED_SETTINGS: ResolvedFeedSettings = {
  ...LEGACY_FEED_SETTINGS,
  excludeFocusTime: false,
  excludeOutOfOffice: false,
};

const feedFor = (
  settings: ResolvedFeedSettings,
  events: FeedEvent[],
  calendarIds: string[] = LEGACY_FEED_CALENDAR_IDS,
  onLoadEvents?: (loaded: string[]) => void,
): Promise<string> =>
  renderFeed({
    calendarIds,
    events,
    onLoadEvents,
    settings: settings as FeedSettings,
  });

beforeAll(async () => {
  goldenFeed = await Bun.file(`${import.meta.dirname}/../fixtures/legacy-feed.ics`).text();
});

describe("legacy feed output", () => {
  it("still renders the pre-migration feed byte-for-byte from the formatter", () => {
    const ics = formatEventsAsIcal(LEGACY_FEED_EVENTS, LEGACY_FEED_SETTINGS as FeedSettings);

    expect(normalizeIcs(ics)).toBe(normalizeIcs(goldenFeed));
  });

  it("renders a backfilled legacy feed identically to the pre-migration feed", async () => {
    const ics = await feedFor(BACKFILLED_SETTINGS, LEGACY_FEED_EVENTS);

    expect(normalizeIcs(ics)).toBe(normalizeIcs(goldenFeed));
  });

  it("renders identically for a user who never saved settings", async () => {
    const ics = await feedFor(
      DEFAULT_FEED_SETTINGS as unknown as ResolvedFeedSettings,
      LEGACY_FEED_EVENTS,
    );

    expect(DEFAULT_FEED_SETTINGS).toEqual(BACKFILLED_SETTINGS);
    expect(normalizeIcs(ics)).toBe(normalizeIcs(goldenFeed));
  });

  it("returns an empty but valid calendar when the feed selects no calendars", async () => {
    const loadedCalendarSets: string[][] = [];
    const ics = await feedFor(
      BACKFILLED_SETTINGS,
      LEGACY_FEED_EVENTS,
      [],
      (calendarIds) => loadedCalendarSets.push(calendarIds),
    );

    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).not.toContain("BEGIN:VEVENT");
    expect(loadedCalendarSets).toEqual([]);
  });

  it("keeps excluding inferred all-day events when excludeAllDayEvents is on", async () => {
    const ics = await feedFor(
      { ...BACKFILLED_SETTINGS, excludeAllDayEvents: true },
      [
        makeFeedEvent({
          id: "inferred-all-day",
          isAllDay: null,
          startTime: new Date("2026-04-03T00:00:00.000Z"),
          endTime: new Date("2026-04-04T00:00:00.000Z"),
        }),
        makeFeedEvent({
          id: "timed-event",
          startTime: new Date("2026-04-03T09:00:00.000Z"),
          endTime: new Date("2026-04-03T10:00:00.000Z"),
        }),
      ],
    );

    expect(ics).not.toContain("inferred-all-day");
    expect(ics).toContain("timed-event");
  });
});
