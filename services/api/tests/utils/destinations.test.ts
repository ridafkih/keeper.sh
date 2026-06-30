import { describe, expect, it } from "vitest";
import { buildReconnectedCalendarState } from "../../src/utils/calendar-state";

describe("buildReconnectedCalendarState", () => {
  it("reactivates the calendar and clears stale failure state", () => {
    expect(buildReconnectedCalendarState("https://caldav.example/new-path/")).toEqual({
      calendarUrl: "https://caldav.example/new-path/",
      disabled: false,
      failureCount: 0,
      lastFailureAt: null,
      nextAttemptAt: null,
    });
  });
});
