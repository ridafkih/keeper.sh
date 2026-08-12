import { describe, expect, it } from "vitest";
import {
  BASE_SOURCE_SYNC_RANGES,
  createRequiredSourceRanges,
} from "../../src/utils/source-ingestion-ranges";

describe("createRequiredSourceRanges", () => {
  it("does not let a narrow destination prune the shared source baseline", () => {
    expect(createRequiredSourceRanges([{
      syncFutureRange: "1_week",
      syncHistoricRange: "1_week",
    }])).toEqual(BASE_SOURCE_SYNC_RANGES);
  });

  it("widens the source store for wider destination consumers", () => {
    expect(createRequiredSourceRanges([{
      syncFutureRange: "12_months",
      syncHistoricRange: "12_months",
    }])).toEqual({
      futureRange: "2_years",
      historicRange: "12_months",
    });
  });

  it("maximizes each axis independently across destinations", () => {
    expect(createRequiredSourceRanges([
      { syncFutureRange: "1_week", syncHistoricRange: "12_months" },
      { syncFutureRange: "2_years", syncHistoricRange: "1_week" },
    ])).toEqual({
      futureRange: "2_years",
      historicRange: "12_months",
    });
  });

  it("does not let a wide future range leak into the historic axis", () => {
    expect(createRequiredSourceRanges([{
      syncFutureRange: "2_years",
      syncHistoricRange: "1_month",
    }])).toEqual({
      futureRange: "2_years",
      historicRange: "1_month",
    });
  });

  it("is order independent", () => {
    const destinations = [
      { syncFutureRange: "1_month", syncHistoricRange: "6_months" },
      { syncFutureRange: "12_months", syncHistoricRange: "3_months" },
    ];

    expect(createRequiredSourceRanges(destinations))
      .toEqual(createRequiredSourceRanges(destinations.toReversed()));
  });
});
