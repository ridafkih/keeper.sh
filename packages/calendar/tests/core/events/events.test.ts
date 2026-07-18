import { describe, expect, it } from "vitest";
import {
  isEventInDestinationReconciliationWindow,
  shouldExcludeSyncEvent,
} from "../../../src/core/events/events";

const createEvent = (overrides: Partial<{
  excludeAllDayEvents: boolean;
  excludeFocusTime: boolean;
  excludeOutOfOffice: boolean;
  availability: string | null;
  isAllDay: boolean | null;
  sourceEventType: string | null;
}> = {}) => ({
  availability: "busy",
  excludeAllDayEvents: false,
  excludeFocusTime: false,
  excludeOutOfOffice: false,
  isAllDay: false,
  sourceEventType: "default",
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
    }, timeMin)).toBe(true);
  });

  it("includes ordinary events arbitrarily far in the future", () => {
    expect(isEventInDestinationReconciliationWindow({
      endTime: new Date("2040-03-15T10:00:00.000Z"),
    }, timeMin)).toBe(true);
  });

  it("excludes events that ended before the boundary", () => {
    expect(isEventInDestinationReconciliationWindow({
      endTime: new Date("2026-07-09T23:59:59.999Z"),
    }, timeMin)).toBe(false);
  });
});
