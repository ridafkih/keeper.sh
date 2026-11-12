import { describe, expect, it } from "vitest";
import {
  isEventInDestinationReconciliationWindow,
  shouldExcludeSyncEvent,
} from "../../../src/core/events/events";

const createEvent = (overrides: Partial<{
  excludeAllDayEvents: boolean;
  excludeAvailabilities: string[];
  excludeFocusTime: boolean;
  excludeOutOfOffice: boolean;
  excludeTitleKeywords: string[];
  availability: string | null;
  isAllDay: boolean | null;
  sourceEventType: string | null;
  title: string | null;
}> = {}) => ({
  availability: "busy",
  excludeAllDayEvents: false,
  excludeAvailabilities: [],
  excludeFocusTime: false,
  excludeOutOfOffice: false,
  excludeTitleKeywords: [],
  isAllDay: false,
  sourceEventType: "default",
  title: "Weekly planning",
  ...overrides,
});

describe("shouldExcludeSyncEvent", () => {
  it("always excludes working location events", () => {
    expect(
      shouldExcludeSyncEvent(
        createEvent({
          sourceEventType: "workingLocation",
        }),
      ),
    ).toBe(true);
  });

  it("excludes focus time events when configured", () => {
    expect(
      shouldExcludeSyncEvent(
        createEvent({
          excludeFocusTime: true,
          sourceEventType: "focusTime",
        }),
      ),
    ).toBe(true);
  });

  it("excludes out of office events when configured", () => {
    expect(
      shouldExcludeSyncEvent(
        createEvent({
          excludeOutOfOffice: true,
          sourceEventType: "outOfOffice",
        }),
      ),
    ).toBe(true);
  });

  it("excludes all-day events when configured", () => {
    expect(
      shouldExcludeSyncEvent(
        createEvent({
          excludeAllDayEvents: true,
          isAllDay: true,
        }),
      ),
    ).toBe(true);
  });

  it("keeps default events in sync", () => {
    expect(shouldExcludeSyncEvent(createEvent())).toBe(false);
  });

  it("treats legacy workingElsewhere rows as working location", () => {
    expect(
      shouldExcludeSyncEvent(
        createEvent({
          availability: "workingElsewhere",
          sourceEventType: null,
        }),
      ),
    ).toBe(true);
  });

  it("excludes events whose availability is an excluded status", () => {
    expect(
      shouldExcludeSyncEvent(
        createEvent({
          availability: "free",
          excludeAvailabilities: ["free"],
        }),
      ),
    ).toBe(true);
  });

  it("keeps events whose availability is not an excluded status", () => {
    expect(shouldExcludeSyncEvent(createEvent({ excludeAvailabilities: ["free"] }))).toBe(false);
  });

  it("treats events without a stored availability as busy", () => {
    expect(
      shouldExcludeSyncEvent(
        createEvent({
          availability: null,
          excludeAvailabilities: ["busy"],
        }),
      ),
    ).toBe(true);
  });

  it("excludes tentative events when tentative is an excluded status", () => {
    expect(
      shouldExcludeSyncEvent(
        createEvent({
          excludeAvailabilities: ["tentative"],
          sourceEventType: "tentative",
        }),
      ),
    ).toBe(true);
  });

  it("excludes free tentative events when only free is excluded", () => {
    expect(
      shouldExcludeSyncEvent(
        createEvent({
          availability: "free",
          excludeAvailabilities: ["free"],
          sourceEventType: "tentative",
        }),
      ),
    ).toBe(true);
  });

  it("keeps busy tentative events when only free is excluded", () => {
    expect(
      shouldExcludeSyncEvent(
        createEvent({
          excludeAvailabilities: ["free"],
          sourceEventType: "tentative",
        }),
      ),
    ).toBe(false);
  });

  it("keeps tentative events when only busy is excluded", () => {
    expect(
      shouldExcludeSyncEvent(
        createEvent({
          excludeAvailabilities: ["busy"],
          sourceEventType: "tentative",
        }),
      ),
    ).toBe(false);
  });

  it("excludes events whose title contains any of the keywords, ignoring case", () => {
    expect(
      shouldExcludeSyncEvent(
        createEvent({
          excludeTitleKeywords: ["placeholder", "ZOOM room"],
          title: "Daily Zoom ROOM",
        }),
      ),
    ).toBe(true);
  });

  it("keeps events whose title contains none of the keywords", () => {
    expect(
      shouldExcludeSyncEvent(
        createEvent({
          excludeTitleKeywords: ["zoom room", "placeholder"],
          title: "Weekly planning",
        }),
      ),
    ).toBe(false);
  });

  it("keeps untitled events when keywords are configured", () => {
    expect(
      shouldExcludeSyncEvent(
        createEvent({
          excludeTitleKeywords: ["zoom room"],
          title: null,
        }),
      ),
    ).toBe(false);
  });

  it("treats legacy oof rows as out of office", () => {
    expect(
      shouldExcludeSyncEvent(
        createEvent({
          availability: "oof",
          excludeOutOfOffice: true,
          sourceEventType: null,
        }),
      ),
    ).toBe(true);
  });
});

describe("isEventInDestinationReconciliationWindow", () => {
  const timeMin = new Date("2026-07-10T00:00:00.000Z");

  it("includes an event that starts before the boundary but overlaps it", () => {
    expect(isEventInDestinationReconciliationWindow({
      endTime: new Date("2026-07-10T01:00:00.000Z"),
      startTime: new Date("2026-07-09T23:00:00.000Z"),
    }, timeMin)).toBe(true);
  });

  it("includes ordinary events arbitrarily far in the future", () => {
    expect(isEventInDestinationReconciliationWindow({
      endTime: new Date("2040-03-15T10:00:00.000Z"),
      startTime: new Date("2040-03-15T09:00:00.000Z"),
    }, timeMin)).toBe(true);
  });

  it("excludes events that ended before the boundary", () => {
    expect(isEventInDestinationReconciliationWindow({
      endTime: new Date("2026-07-09T23:59:59.999Z"),
      startTime: new Date("2026-07-09T22:00:00.000Z"),
    }, timeMin)).toBe(false);
  });

  it("includes an inverted event whose start is past the boundary but whose end is not", () => {
    expect(isEventInDestinationReconciliationWindow({
      endTime: new Date("2026-01-01T00:00:00.000Z"),
      startTime: new Date("2026-08-01T00:00:00.000Z"),
    }, timeMin)).toBe(true);
  });

  it("excludes an inverted event whose start is also before the boundary", () => {
    expect(isEventInDestinationReconciliationWindow({
      endTime: new Date("2026-01-01T00:00:00.000Z"),
      startTime: new Date("2026-02-01T00:00:00.000Z"),
    }, timeMin)).toBe(false);
  });
});

describe("destination reconciliation source selection", () => {
  it("never narrows the mapped source calendars by availability", async () => {
    const source = await Bun.file(
      `${import.meta.dirname}/../../../src/core/events/events.ts`,
    ).text();

    expect(source).toContain("getMappedSourceCalendarIds");
    expect(source).not.toContain("unavailableSince");
  });
});
