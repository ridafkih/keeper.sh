import { describe, expect, it } from "vitest";
import { formatEventsAsIcal } from "../../src/utils/ical-format";
import type { FeedSettings } from "../../src/utils/ical-format";
import { LEGACY_FEED_EVENTS, LEGACY_FEED_SETTINGS, makeFeedEvent } from "../fixtures/legacy-feed-events";

interface PerFeedSettings {
  includeEventName: boolean;
  includeEventDescription: boolean;
  includeEventLocation: boolean;
  excludeAllDayEvents: boolean;
  excludeFocusTime: boolean;
  excludeOutOfOffice: boolean;
  customEventName: string;
}

const FILTERS_OFF: PerFeedSettings = {
  ...LEGACY_FEED_SETTINGS,
  excludeFocusTime: false,
  excludeOutOfOffice: false,
};

const normalizeIcs = (ics: string): string =>
  ics.replaceAll(/DTSTAMP:[0-9TZ]+/g, "DTSTAMP:X");

const occurrences = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

describe("per-feed event filters", () => {
  it("leaves output unchanged when the new filters are off", () => {
    const withoutFilters = formatEventsAsIcal(
      LEGACY_FEED_EVENTS,
      LEGACY_FEED_SETTINGS as FeedSettings,
    );
    const withFiltersOff = formatEventsAsIcal(LEGACY_FEED_EVENTS, FILTERS_OFF);

    expect(normalizeIcs(withFiltersOff)).toBe(normalizeIcs(withoutFilters));
  });

  it("drops focus-time events when the feed excludes them", () => {
    const ics = formatEventsAsIcal(
      [
        makeFeedEvent({ id: "focus-block", sourceEventType: "focusTime" }),
        makeFeedEvent({ id: "regular-block" }),
      ],
      { ...FILTERS_OFF, excludeFocusTime: true },
    );

    expect(ics).not.toContain("focus-block");
    expect(ics).toContain("regular-block");
  });

  it("keeps focus-time events when only out-of-office is excluded", () => {
    const ics = formatEventsAsIcal(
      [makeFeedEvent({ id: "focus-block", sourceEventType: "focusTime" })],
      { ...FILTERS_OFF, excludeOutOfOffice: true },
    );

    expect(ics).toContain("focus-block");
  });

  it("drops out-of-office events including availability-derived ones", () => {
    const ics = formatEventsAsIcal(
      [
        makeFeedEvent({ id: "typed-ooo", sourceEventType: "outOfOffice" }),
        makeFeedEvent({ id: "availability-ooo", availability: "oof" }),
        makeFeedEvent({ id: "regular-block" }),
      ],
      { ...FILTERS_OFF, excludeOutOfOffice: true },
    );

    expect(ics).not.toContain("typed-ooo");
    expect(ics).not.toContain("availability-ooo");
    expect(ics).toContain("regular-block");
  });

  it("adds an EXDATE when a filtered override is dropped from a recurring master", () => {
    const recurrenceId = new Date("2026-04-06T18:00:00.000Z");
    const ics = formatEventsAsIcal(
      [
        makeFeedEvent({
          id: "timed-master",
          sourceEventUid: "mixed-series",
          startTime: new Date("2026-03-30T18:00:00.000Z"),
          endTime: new Date("2026-03-30T19:00:00.000Z"),
          recurrenceRule: { frequency: "WEEKLY" } as never,
        }),
        makeFeedEvent({
          id: "focus-override",
          sourceEventUid: "mixed-series",
          sourceEventType: "focusTime",
          recurrenceId,
          startTime: new Date("2026-04-06T20:00:00.000Z"),
          endTime: new Date("2026-04-06T21:00:00.000Z"),
        }),
      ],
      { ...FILTERS_OFF, excludeFocusTime: true },
    );

    expect(ics).toMatch(/RRULE:FREQ=WEEKLY/);
    expect(ics).toContain("EXDATE:20260406T180000Z");
    expect(ics).not.toContain("RECURRENCE-ID");
    expect(occurrences(ics, "BEGIN:VEVENT")).toBe(1);
  });
});
