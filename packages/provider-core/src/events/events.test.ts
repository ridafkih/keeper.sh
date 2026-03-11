import { describe, expect, it } from "bun:test";
import { shouldExcludeSyncEvent } from "./events";

const createEvent = (overrides: Partial<{
  excludeAllDayEvents: boolean;
  excludeFocusTime: boolean;
  excludeOutOfOffice: boolean;
  excludeWorkingLocation: boolean;
  availability: string | null;
  isAllDay: boolean | null;
  sourceEventType: string | null;
}> = {}) => ({
  availability: "busy",
  excludeAllDayEvents: false,
  excludeFocusTime: false,
  excludeOutOfOffice: false,
  excludeWorkingLocation: false,
  isAllDay: false,
  sourceEventType: "default",
  ...overrides,
});

describe("shouldExcludeSyncEvent", () => {
  it("excludes working location events when configured", () => {
    expect(
      shouldExcludeSyncEvent(
        createEvent({
          excludeWorkingLocation: true,
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
          excludeWorkingLocation: true,
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
