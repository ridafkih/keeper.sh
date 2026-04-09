import { describe, expect, it } from "vitest";
import { getCalDAVSyncWindow } from "../../../../src/providers/caldav/shared/sync-window";

describe("caldav destination sync window", () => {
  it("includes the seven-day lookback needed for reconciliation", () => {
    const startOfToday = new Date("2026-03-09T00:00:00.000Z");

    const window = getCalDAVSyncWindow(2, startOfToday);

    expect(window.start.toISOString()).toBe("2026-03-02T00:00:00.000Z");
    expect(window.end.toISOString()).toBe("2028-03-09T00:00:00.000Z");
  });
});
