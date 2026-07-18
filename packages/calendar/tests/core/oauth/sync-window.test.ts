import { describe, expect, it } from "vitest";
import {
  getDeterministicRefreshOffset,
  getOAuthSyncTokenVersion,
  getOAuthSyncWindow,
  getOAuthSyncWindowStart,
} from "../../../src/core/oauth/sync-window";

describe("oauth sync window", () => {
  it("returns a start date seven days before the provided day boundary", () => {
    const providedStartOfToday = new Date("2026-03-09T00:00:00.000Z");

    const lookbackStart = getOAuthSyncWindowStart(providedStartOfToday);

    expect(lookbackStart.toISOString()).toBe("2026-03-02T00:00:00.000Z");
  });

  it("returns a window with lookback start and configured future bound", () => {
    const providedStartOfToday = new Date("2026-03-09T00:00:00.000Z");

    const syncWindow = getOAuthSyncWindow(2, providedStartOfToday);

    expect(syncWindow.timeMin.toISOString()).toBe("2026-03-02T00:00:00.000Z");
    expect(syncWindow.timeMax.toISOString()).toBe("2028-03-09T00:00:00.000Z");
  });

  it("staggers seven-day token refresh boundaries deterministically per calendar", () => {
    const calendarA = "calendar-a";
    const calendarB = "calendar-b";
    const offsetA = getDeterministicRefreshOffset(calendarA);
    const offsetB = getDeterministicRefreshOffset(calendarB);
    expect(offsetA).not.toBe(offsetB);

    const fleetBoundary = new Date("2026-07-02T00:00:00.000Z");
    const beforeFleetBoundary = new Date(fleetBoundary.getTime() - 1);
    const baseVersion = getOAuthSyncTokenVersion(0, beforeFleetBoundary, calendarA);
    expect(getOAuthSyncTokenVersion(0, beforeFleetBoundary, calendarB)).toBe(baseVersion);

    let earlierCalendar = calendarA;
    let laterCalendar = calendarB;
    if (offsetB < offsetA) {
      earlierCalendar = calendarB;
      laterCalendar = calendarA;
    }
    const earlierOffset = Math.min(offsetA, offsetB);
    expect(getOAuthSyncTokenVersion(
      0,
      new Date(fleetBoundary.getTime() + earlierOffset),
      earlierCalendar,
    )).toBe(baseVersion + 100);
    expect(getOAuthSyncTokenVersion(
      0,
      new Date(fleetBoundary.getTime() + earlierOffset),
      laterCalendar,
    )).toBe(baseVersion);
  });
});
