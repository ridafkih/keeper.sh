import { describe, expect, it } from "vitest";
import { getCalDAVSyncWindow } from "../../../../src/providers/caldav/source/sync-window";

describe("caldav sync window", () => {
  it("returns a lookback start date seven days before today", () => {
    const startOfToday = new Date("2026-03-09T00:00:00.000Z");

    const window = getCalDAVSyncWindow(2, startOfToday);

    expect(window.start.toISOString()).toBe("2026-03-02T00:00:00.000Z");
    expect(window.end.toISOString()).toBe("2028-03-09T00:00:00.000Z");
  });
});
