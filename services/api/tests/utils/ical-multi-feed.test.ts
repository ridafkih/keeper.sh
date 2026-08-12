import { describe, expect, it } from "vitest";
import { renderFeed } from "../fixtures/render-feed";
import { makeFeedEvent } from "../fixtures/legacy-feed-events";
import type { FeedEvent } from "../fixtures/legacy-feed-events";
import type { FeedSettings } from "../../src/utils/ical-format";

interface PerFeedSettings {
  includeEventName: boolean;
  includeEventDescription: boolean;
  includeEventLocation: boolean;
  excludeAllDayEvents: boolean;
  excludeFocusTime: boolean;
  excludeOutOfOffice: boolean;
  customEventName: string;
}

const PRIVATE_SETTINGS: PerFeedSettings = {
  includeEventName: false,
  includeEventDescription: false,
  includeEventLocation: false,
  excludeAllDayEvents: false,
  excludeFocusTime: false,
  excludeOutOfOffice: false,
  customEventName: "Busy",
};

const ALL_EVENTS: FeedEvent[] = [
  makeFeedEvent({
    id: "work-standup",
    calendarId: "calendar-work",
    calendarName: "Work",
    title: "Standup",
    description: "Sprint 42 sync",
    location: "Room 3",
    startTime: new Date("2026-04-06T09:00:00.000Z"),
    endTime: new Date("2026-04-06T09:15:00.000Z"),
  }),
  makeFeedEvent({
    id: "work-focus",
    calendarId: "calendar-work",
    calendarName: "Work",
    title: "Deep work",
    sourceEventType: "focusTime",
    startTime: new Date("2026-04-06T10:00:00.000Z"),
    endTime: new Date("2026-04-06T12:00:00.000Z"),
  }),
  makeFeedEvent({
    id: "personal-therapy",
    calendarId: "calendar-personal",
    calendarName: "Personal",
    title: "Therapy",
    description: "Weekly session",
    location: "9 Quiet Lane",
    startTime: new Date("2026-04-06T17:00:00.000Z"),
    endTime: new Date("2026-04-06T18:00:00.000Z"),
  }),
];

const feedFor = (
  settings: PerFeedSettings,
  calendarIds: string[],
  events: FeedEvent[] = ALL_EVENTS,
): Promise<string> =>
  renderFeed({ calendarIds, events, settings: settings as FeedSettings });

const summaries = (ics: string): string[] =>
  ics.split(/\r?\n/).filter((line) => line.startsWith("SUMMARY:"));

describe("multiple iCal feeds on one account", () => {
  it("serves only the events from a feed's own calendar selection", async () => {
    const ics = await feedFor(PRIVATE_SETTINGS, ["calendar-work"]);

    expect(ics).toContain("work-standup");
    expect(ics).toContain("work-focus");
    expect(ics).not.toContain("personal-therapy");
  });

  it("gives two feeds on the same account different content", async () => {
    const workOnly = await feedFor(PRIVATE_SETTINGS, ["calendar-work"]);
    const personalOnly = await feedFor(PRIVATE_SETTINGS, ["calendar-personal"]);

    expect(workOnly).not.toBe(personalOnly);
    expect(workOnly).toContain("work-standup");
    expect(workOnly).not.toContain("personal-therapy");
    expect(personalOnly).toContain("personal-therapy");
    expect(personalOnly).not.toContain("work-standup");
  });

  it("applies each feed's privacy settings independently", async () => {
    const calendarIds = ["calendar-work", "calendar-personal"];
    const sharedLink = await feedFor(PRIVATE_SETTINGS, calendarIds);
    const ownLink = await feedFor({
      ...PRIVATE_SETTINGS,
      includeEventName: true,
      includeEventDescription: true,
      includeEventLocation: true,
    }, calendarIds);

    expect(summaries(sharedLink)).toEqual(["SUMMARY:Busy", "SUMMARY:Busy", "SUMMARY:Busy"]);
    expect(sharedLink).not.toContain("Sprint 42 sync");
    expect(sharedLink).not.toContain("9 Quiet Lane");

    expect(summaries(ownLink)).toEqual([
      "SUMMARY:Standup",
      "SUMMARY:Deep work",
      "SUMMARY:Therapy",
    ]);
    expect(ownLink).toContain("Sprint 42 sync");
    expect(ownLink).toContain("9 Quiet Lane");
  });

  it("applies each feed's event filters independently", async () => {
    const calendarIds = ["calendar-work"];
    const unfiltered = await feedFor(PRIVATE_SETTINGS, calendarIds);
    const filtered = await feedFor(
      { ...PRIVATE_SETTINGS, excludeFocusTime: true },
      calendarIds,
    );

    expect(unfiltered).toContain("work-focus");
    expect(filtered).not.toContain("work-focus");
    expect(filtered).toContain("work-standup");
  });
});
