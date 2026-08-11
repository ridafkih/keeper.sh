import { describe, expect, it } from "vitest";
import { isCalDAVEventInSyncWindow } from "../../../../src/providers/caldav/source/fetch-adapter";

const SYNC_WINDOW = {
  timeMax: new Date("2026-06-01T00:00:00.000Z"),
  timeMin: new Date("2026-03-01T00:00:00.000Z"),
};

describe("isCalDAVEventInSyncWindow", () => {
  it("drops a non-recurring event that ends exactly at the window start", () => {
    expect(isCalDAVEventInSyncWindow({
      endTime: SYNC_WINDOW.timeMin,
      startTime: new Date("2026-02-28T23:00:00.000Z"),
    }, SYNC_WINDOW)).toBe(false);
  });

  it("drops a non-recurring event that starts exactly at the window end", () => {
    expect(isCalDAVEventInSyncWindow({
      endTime: new Date("2026-06-01T01:00:00.000Z"),
      startTime: SYNC_WINDOW.timeMax,
    }, SYNC_WINDOW)).toBe(false);
  });

  it("keeps a non-recurring event overlapping either boundary by a moment", () => {
    expect(isCalDAVEventInSyncWindow({
      endTime: new Date("2026-03-01T00:00:00.001Z"),
      startTime: new Date("2026-02-28T23:00:00.000Z"),
    }, SYNC_WINDOW)).toBe(true);
    expect(isCalDAVEventInSyncWindow({
      endTime: new Date("2026-06-01T01:00:00.000Z"),
      startTime: new Date("2026-05-31T23:59:59.999Z"),
    }, SYNC_WINDOW)).toBe(true);
  });

  it("keeps an all-day event ending at midnight on the window start", () => {
    expect(isCalDAVEventInSyncWindow({
      endTime: new Date("2026-03-02T00:00:00.000Z"),
      startTime: new Date("2026-03-01T00:00:00.000Z"),
    }, SYNC_WINDOW)).toBe(true);
  });

  it("keeps a recurring master that lies entirely before the window", () => {
    expect(isCalDAVEventInSyncWindow({
      endTime: new Date("2020-01-01T01:00:00.000Z"),
      recurrenceRule: { frequency: "WEEKLY" },
      startTime: new Date("2020-01-01T00:00:00.000Z"),
    }, SYNC_WINDOW)).toBe(true);
  });
});
