import { describe, expect, it } from "bun:test";
import { getOAuthSyncWindow, getOAuthSyncWindowStart } from "../../../src/core/oauth/sync-window";

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
});
