import { describe, expect, it } from "vitest";
import { MS_PER_DAY } from "@keeper.sh/constants";
import {
  DEFAULT_FUTURE_SYNC_RANGE,
  DEFAULT_HISTORIC_SYNC_RANGE,
  createSyncWindow,
  getStartOfToday,
  getConfigurableSyncWindow,
  getWiderSyncRange,
  intersectSyncWindows,
} from "../../../src/core/sync/sync-range";

describe("configurable sync ranges", () => {
  it("builds independent historic and future windows from the start of today", () => {
    const window = getConfigurableSyncWindow(
      "3_months",
      "2_years",
      new Date(2026, 6, 20, 15, 42, 10),
    );

    expect(window).toEqual({
      timeMin: new Date(2026, 3, 20),
      timeMax: new Date(2028, 6, 20),
    });
  });

  it("clamps month ranges at the end of shorter months", () => {
    const window = getConfigurableSyncWindow(
      "1_month",
      "1_month",
      new Date(2026, 2, 31, 12),
    );

    expect(window).toEqual({
      timeMin: new Date(2026, 1, 28),
      timeMax: new Date(2026, 3, 30),
    });
  });

  it("selects the widest range needed by mapped destinations", () => {
    expect(getWiderSyncRange("3_months", "12_months")).toBe("12_months");
    expect(getWiderSyncRange("12_months", "3_months")).toBe("12_months");
    expect(getWiderSyncRange("1_week", "1_week")).toBe("1_week");
  });

  it("defaults one month back and two years forward, deliberately wider than the retired fixed window", () => {
    const now = new Date(2026, 6, 20, 15, 42, 10);
    const startOfToday = getStartOfToday(now);

    const defaults = getConfigurableSyncWindow(
      DEFAULT_HISTORIC_SYNC_RANGE,
      DEFAULT_FUTURE_SYNC_RANGE,
      now,
    );

    expect(defaults).toEqual({
      timeMin: new Date(2026, 5, 20),
      timeMax: new Date(2028, 6, 20),
    });
    expect(defaults.timeMin.getTime()).toBeLessThan(
      startOfToday.getTime() - 7 * MS_PER_DAY,
    );
  });

  it("advances the window by exactly one day across a day boundary", () => {
    const firstTick = new Date(2026, 6, 20, 9, 0, 0);
    const laterSameDay = new Date(2026, 6, 20, 23, 59, 59);
    const nextDay = new Date(2026, 6, 21, 0, 0, 1);

    const first = getConfigurableSyncWindow("1_week", "1_month", firstTick);
    const later = getConfigurableSyncWindow("1_week", "1_month", laterSameDay);
    const next = getConfigurableSyncWindow("1_week", "1_month", nextDay);

    expect(later).toEqual(first);
    expect(next.timeMin.getTime() - first.timeMin.getTime()).toBe(MS_PER_DAY);
    expect(next.timeMin.getTime()).toBeGreaterThan(first.timeMin.getTime());
  });

  it("anchors to local midnight in any server timezone", () => {
    /*
     * Deleting TZ does not put the process back in the zone it started in — the runtime
     * keeps the last one it was told — so the zone the machine resolved to is what is
     * written back, whether or not TZ was set to begin with.
     */
    const originalTimeZone = process.env.TZ
      ?? new Intl.DateTimeFormat().resolvedOptions().timeZone;
    const originalOffset = new Date().getTimezoneOffset();
    const observedOffsets = new Set<number>();
    try {
      for (const timeZone of ["UTC", "America/Los_Angeles", "Asia/Kolkata", "Pacific/Kiritimati"]) {
        process.env.TZ = timeZone;
        const now = new Date(2026, 6, 20, 15, 42, 10);
        observedOffsets.add(now.getTimezoneOffset());
        const window = getConfigurableSyncWindow("1_week", "1_month", now);

        expect(window.timeMin.getHours()).toBe(0);
        expect(window.timeMin.getMinutes()).toBe(0);
        expect(window.timeMax.getHours()).toBe(0);
        expect(window.timeMin.getTime()).toBeLessThan(window.timeMax.getTime());
      }
    } finally {
      process.env.TZ = originalTimeZone;
    }

    expect(observedOffsets.size).toBe(4);
    expect(new Date().getTimezoneOffset()).toBe(originalOffset);
  });

  it("rejects unrecognized ranges instead of ordering them as narrowest", () => {
    const unsupported = "5_years" as never;

    expect(() => getWiderSyncRange(unsupported, "1_week")).toThrow(
      "Unsupported sync range: 5_years",
    );
    expect(() => getWiderSyncRange("1_week", unsupported)).toThrow(
      "Unsupported sync range: 5_years",
    );
  });

  it("rejects invalid windows and represents empty intersections as null", () => {
    const boundary = new Date("2026-03-01T00:00:00.000Z");
    expect(() => createSyncWindow(boundary, boundary)).toThrow(
      "Sync window start must be before its end",
    );
    expect(intersectSyncWindows(
      createSyncWindow(
        new Date("2026-01-01T00:00:00.000Z"),
        new Date("2026-02-01T00:00:00.000Z"),
      ),
      createSyncWindow(
        new Date("2026-02-01T00:00:00.000Z"),
        new Date("2026-03-01T00:00:00.000Z"),
      ),
    )).toBeNull();
  });
});
