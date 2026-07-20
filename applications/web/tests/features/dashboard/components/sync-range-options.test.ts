import { describe, expect, it } from "vitest";
import {
  getSyncRangeLabel,
  SYNC_RANGE_OPTIONS,
} from "../../../../src/features/dashboard/components/sync-range-options";

describe("sync range options", () => {
  it("exposes every API-supported range in ascending order", () => {
    expect(SYNC_RANGE_OPTIONS.map(({ value }) => value)).toEqual([
      "1_week",
      "1_month",
      "3_months",
      "6_months",
      "12_months",
      "2_years",
    ]);
  });

  it("uses human-readable labels", () => {
    expect(getSyncRangeLabel("1_week")).toBe("1 Week");
    expect(getSyncRangeLabel("2_years")).toBe("2 Years");
  });
});
