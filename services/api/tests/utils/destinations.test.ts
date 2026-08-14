import { describe, expect, it } from "vitest";
import {
  buildReconnectedCalDAVState,
  RECONNECTED_CALENDAR_STATE,
} from "../../src/utils/calendar-state";

describe("buildReconnectedCalDAVState", () => {
  it("repoints the calendar and clears stale failure state without touching the pause", () => {
    expect(buildReconnectedCalDAVState("https://caldav.example/new-path/")).toEqual({
      calendarUrl: "https://caldav.example/new-path/",
      failureCount: 0,
      lastFailureAt: null,
      nextAttemptAt: null,
      ingestFailureCount: 0,
      ingestLastFailureAt: null,
      ingestNextAttemptAt: null,
    });
  });

  it("never writes disabled, so a deliberately paused calendar stays paused", () => {
    expect(buildReconnectedCalDAVState("https://caldav.example/new-path/"))
      .not.toHaveProperty("disabled");
  });

  it("clears both directional retry clocks when a calendar is resumed", () => {
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
