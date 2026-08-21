import { describe, expect, it } from "vitest";
import {
  canCreateFeed,
  resolveCalendarSelection,
  resolveEventNamePatch,
  resolveFeedDisclosure,
  resolveFeedNeighbours,
  resolvePickableCalendars,
} from "../../src/utils/ical-feeds";
import type { CalendarSource } from "../../src/types/api";

const makeSource = (overrides: Partial<CalendarSource> = {}): CalendarSource => ({
  id: "calendar-1",
  name: "Work",
  calendarType: "google",
  capabilities: ["pull"],
  accountId: "account-1",
  provider: "google",
  providerName: "Google",
  providerIcon: null,
  displayName: "Ada Lovelace",
  email: "ada@example.com",
  accountLabel: "Google · ada@example.com",
  accountIdentifier: "ada@example.com",
  needsReauthentication: false,
  includeInIcalFeed: false,
  unavailableSince: null,
  disabled: false,
  providerMissingSince: null,
  ...overrides,
});

describe("resolvePickableCalendars", () => {
  it("keeps the pickable set to calendars that can be read from, in source order", () => {
    const calendars = resolvePickableCalendars([
      makeSource({ id: "calendar-pull", capabilities: ["pull"] }),
      makeSource({ id: "calendar-push", capabilities: ["push"] }),
      makeSource({ id: "calendar-both", capabilities: ["pull", "push"] }),
    ]);

    expect(calendars.map(({ id }) => id)).toEqual(["calendar-pull", "calendar-both"]);
  });

  it("offers nothing when no calendar can be read from", () => {
    expect(resolvePickableCalendars([makeSource({ capabilities: ["push"] })])).toEqual([]);
  });
});

describe("canCreateFeed", () => {
  it("disables creation once the free allowance is used", () => {
    expect(canCreateFeed({ feeds: { current: 1, limit: 1 } })).toBe(false);
  });

  it("allows creation while the allowance remains", () => {
    expect(canCreateFeed({ feeds: { current: 0, limit: 1 } })).toBe(true);
  });

  it("allows creation on an unlimited plan", () => {
    expect(canCreateFeed({ feeds: { current: 12, limit: null } })).toBe(true);
  });

  it("fails open while entitlements are still loading", () => {
    expect(canCreateFeed(undefined)).toBe(true);
  });
});

describe("resolveFeedDisclosure", () => {
  const settings = {
    includeEventName: false,
    includeEventDescription: false,
    includeEventLocation: false,
  };

  it("says times only when no event detail is shared", () => {
    expect(resolveFeedDisclosure(settings)).toBe("This link shares event times only.");
  });

  it("names descriptions even when event names are hidden", () => {
    expect(resolveFeedDisclosure({ ...settings, includeEventDescription: true }))
      .toBe("This link shares event times and descriptions.");
  });

  it("names locations even when event names are hidden", () => {
    expect(resolveFeedDisclosure({ ...settings, includeEventLocation: true }))
      .toBe("This link shares event times and locations.");
  });

  it("names descriptions and locations shared without event names", () => {
    expect(resolveFeedDisclosure({
      ...settings,
      includeEventDescription: true,
      includeEventLocation: true,
    })).toBe("This link shares event times, descriptions and locations.");
  });

  it("names events when only names are shared", () => {
    expect(resolveFeedDisclosure({ ...settings, includeEventName: true }))
      .toBe("This link shares event times and names.");
  });

  it("names every detail shared", () => {
    expect(resolveFeedDisclosure({
      includeEventName: true,
      includeEventDescription: true,
      includeEventLocation: true,
    })).toBe("This link shares event times, names, descriptions and locations.");
  });
});

describe("resolveEventNamePatch", () => {
  it("restores the event name template when names are shared again", () => {
    expect(resolveEventNamePatch(true)).toEqual({
      includeEventName: true,
      customEventName: "{{event_name}}",
    });
  });

  it("falls back to a placeholder title when names are hidden", () => {
    expect(resolveEventNamePatch(false)).toEqual({
      includeEventName: false,
      customEventName: "Busy",
    });
  });
});

describe("resolveCalendarSelection", () => {
  it("adds a newly checked calendar to the end of the selection", () => {
    expect(resolveCalendarSelection(["calendar-a"], "calendar-b", true))
      .toEqual(["calendar-a", "calendar-b"]);
  });

  it("removes an unchecked calendar", () => {
    expect(resolveCalendarSelection(["calendar-a", "calendar-b"], "calendar-a", false))
      .toEqual(["calendar-b"]);
  });

  it("keeps the selection unchanged when a checked calendar is already selected", () => {
    expect(resolveCalendarSelection(new Set(["calendar-a"]), "calendar-a", true))
      .toEqual(["calendar-a"]);
  });
});

describe("resolveFeedNeighbours", () => {
  const feeds = [{ id: "feed-a" }, { id: "feed-b" }, { id: "feed-c" }];

  it("finds the feeds either side of the current one", () => {
    expect(resolveFeedNeighbours(feeds, "feed-b")).toEqual({
      previous: { id: "feed-a" },
      next: { id: "feed-c" },
    });
  });

  it("has no previous feed at the start of the list", () => {
    expect(resolveFeedNeighbours(feeds, "feed-a")).toEqual({
      previous: null,
      next: { id: "feed-b" },
    });
  });

  it("has no next feed at the end of the list", () => {
    expect(resolveFeedNeighbours(feeds, "feed-c")).toEqual({
      previous: { id: "feed-b" },
      next: null,
    });
  });

  it("has no neighbours for a feed missing from the list", () => {
    expect(resolveFeedNeighbours(feeds, "feed-z")).toEqual({ previous: null, next: null });
  });
});
