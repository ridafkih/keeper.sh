import { describe, expect, it } from "vitest";
import {
  buildCalendarBackoffState,
  RESET_CALENDAR_BACKOFF_STATE,
} from "../../../src/core/utils/calendar-backoff";

describe("buildCalendarBackoffState", () => {
  const now = new Date("2026-06-30T18:00:00.000Z");

  it("backs off the first failure for five minutes", () => {
    expect(buildCalendarBackoffState(0, now)).toEqual({
      failureCount: 1,
      lastFailureAt: now,
      nextAttemptAt: new Date("2026-06-30T18:05:00.000Z"),
    });
  });

  it("doubles repeated delays and caps them at six hours", () => {
    expect(buildCalendarBackoffState(1, now).nextAttemptAt).toEqual(
      new Date("2026-06-30T18:10:00.000Z"),
    );
    expect(buildCalendarBackoffState(20, now).nextAttemptAt).toEqual(
      new Date("2026-07-01T00:00:00.000Z"),
    );
  });

  it("provides a reusable successful-sync reset", () => {
    expect(RESET_CALENDAR_BACKOFF_STATE).toEqual({
      failureCount: 0,
      lastFailureAt: null,
      nextAttemptAt: null,
    });
  });
});
