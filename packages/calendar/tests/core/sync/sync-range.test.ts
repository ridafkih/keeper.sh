import { describe, expect, it } from "vitest";
import {
  getConfigurableSyncWindow,
  getWiderSyncRange,
  isSyncRangeWider,
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
    expect(isSyncRangeWider("2_years", "12_months")).toBe(true);
    expect(isSyncRangeWider("1_week", "1_month")).toBe(false);
  });
});
