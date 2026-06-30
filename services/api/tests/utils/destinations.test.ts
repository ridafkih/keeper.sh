import { describe, expect, it } from "vitest";
import {
  buildReconnectedCalendarState,
  RECONNECTED_CALENDAR_STATE,
} from "../../src/utils/calendar-state";

describe("buildReconnectedCalendarState", () => {
  it("reactivates the calendar and clears stale failure state", () => {
    expect(buildReconnectedCalendarState("https://caldav.example/new-path/")).toEqual({
      calendarUrl: "https://caldav.example/new-path/",
      disabled: false,
      failureCount: 0,
      lastFailureAt: null,
      nextAttemptAt: null,
      ingestFailureCount: 0,
      ingestLastFailureAt: null,
      ingestNextAttemptAt: null,
    });
  });

  it("clears both directional retry clocks when OAuth credentials are reconnected", () => {
    expect(RECONNECTED_CALENDAR_STATE).toEqual({
      disabled: false,
      failureCount: 0,
      lastFailureAt: null,
      nextAttemptAt: null,
      ingestFailureCount: 0,
      ingestLastFailureAt: null,
      ingestNextAttemptAt: null,
    });
  });
});
