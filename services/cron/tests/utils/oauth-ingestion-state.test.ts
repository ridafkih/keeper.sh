import { describe, expect, it } from "vitest";
import { resolveOAuthIngestionState } from "../../src/utils/oauth-ingestion-state";

const REQUIRED_RANGES = {
  futureRange: "2_years",
  historicRange: "1_week",
} as const;
const COMPLETE_COVERAGE = {
  futureRange: "2_years",
  historicRange: "1_week",
  syncToken: "incremental-token",
  windowEnd: new Date("2028-01-01T00:00:00.000Z"),
  windowRecordedAt: new Date("2026-01-01T00:00:00.000Z"),
  windowStart: new Date("2025-12-25T00:00:00.000Z"),
};

describe("resolveOAuthIngestionState", () => {
  it.each(["windowStart", "windowEnd", "windowRecordedAt"] as const)(
    "forces a full sync when %s is missing",
    (field) => {
      const state = resolveOAuthIngestionState({
        ...COMPLETE_COVERAGE,
        [field]: null,
      }, REQUIRED_RANGES);

      expect(state).toEqual({
        authorityChanged: true,
        coverageState: "unverified",
        fullSyncReason: "coverage_missing",
        syncToken: null,
      });
    },
  );

  it("preserves the incremental token when verified coverage matches", () => {
    expect(resolveOAuthIngestionState(COMPLETE_COVERAGE, REQUIRED_RANGES)).toEqual({
      authorityChanged: false,
      coverageState: "verified",
      fullSyncReason: null,
      syncToken: "incremental-token",
    });
  });

  it("forces a full sync when the required range changes", () => {
    const state = resolveOAuthIngestionState(COMPLETE_COVERAGE, {
      ...REQUIRED_RANGES,
      historicRange: "1_month",
    });

    expect(state).toEqual({
      authorityChanged: true,
      coverageState: "verified",
      fullSyncReason: "range_changed",
      syncToken: null,
    });
  });

  it("forces a full sync when stored coverage labels are invalid", () => {
    const state = resolveOAuthIngestionState({
      ...COMPLETE_COVERAGE,
      historicRange: "unknown",
    }, REQUIRED_RANGES);

    expect(state).toEqual({
      authorityChanged: true,
      coverageState: "unverified",
      fullSyncReason: "coverage_invalid",
      syncToken: null,
    });
  });

  it("forces a full sync when stored coverage dates are invalid", () => {
    const state = resolveOAuthIngestionState({
      ...COMPLETE_COVERAGE,
      windowStart: COMPLETE_COVERAGE.windowEnd,
    }, REQUIRED_RANGES);

    expect(state).toEqual({
      authorityChanged: true,
      coverageState: "unverified",
      fullSyncReason: "coverage_invalid",
      syncToken: null,
    });
  });

  it("reports a full sync when verified coverage has no incremental token", () => {
    const state = resolveOAuthIngestionState({
      ...COMPLETE_COVERAGE,
      syncToken: null,
    }, REQUIRED_RANGES);

    expect(state).toEqual({
      authorityChanged: false,
      coverageState: "verified",
      fullSyncReason: "sync_token_missing",
      syncToken: null,
    });
  });
});
