import { describe, expect, it } from "vitest";
import {
  canCreateFeed,
  groupCalendarsByAccount,
  resolveFeedDisclosure,
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
  ...overrides,
});

describe("groupCalendarsByAccount", () => {
  it("groups calendars under their account label in source order", () => {
    const groups = groupCalendarsByAccount([
      makeSource({ id: "calendar-a", accountId: "account-1", name: "Work" }),
      makeSource({
        id: "calendar-b",
        accountId: "account-2",
        name: "Family",
        accountLabel: "iCloud · ada@icloud.com",
      }),
      makeSource({ id: "calendar-c", accountId: "account-1", name: "Team" }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.accountId).toBe("account-1");
    expect(groups[0]?.label).toBe("Google · ada@example.com");
    expect(groups[0]?.calendars.map(({ id }) => id)).toEqual(["calendar-a", "calendar-c"]);
    expect(groups[1]?.accountId).toBe("account-2");
    expect(groups[1]?.calendars.map(({ id }) => id)).toEqual(["calendar-b"]);
  });

  it("keeps the pickable set to calendars that can be read from", () => {
    const groups = groupCalendarsByAccount([
      makeSource({ id: "calendar-pull", capabilities: ["pull"] }),
      makeSource({ id: "calendar-both", capabilities: ["pull", "push"] }),
      makeSource({ id: "calendar-push", capabilities: ["push"] }),
    ]);

    expect(groups.flatMap(({ calendars }) => calendars.map(({ id }) => id)))
      .toEqual(["calendar-pull", "calendar-both"]);
  });

  it("returns no groups for an account with nothing pickable", () => {
    expect(groupCalendarsByAccount([makeSource({ capabilities: ["push"] })])).toEqual([]);
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
