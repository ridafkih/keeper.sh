import { syncRangeSchema } from "@keeper.sh/data-schemas";
import type { RequiredSourceRanges } from "@keeper.sh/calendar";

interface StoredOAuthIngestionState {
  futureRange: string;
  historicRange: string;
  syncToken: string | null;
  windowEnd: Date | null;
  windowRecordedAt: Date | null;
  windowStart: Date | null;
}

interface OAuthIngestionState {
  authorityChanged: boolean;
  coverageState: "unverified" | "verified";
  fullSyncReason:
    | "coverage_invalid"
    | "coverage_missing"
    | "range_changed"
    | "sync_token_missing"
    | null;
  syncToken: string | null;
}

const hasCompleteCoverageWindow = (
  stored: StoredOAuthIngestionState,
): boolean => Boolean(
  stored.windowStart
  && stored.windowEnd
  && stored.windowRecordedAt,
);

const hasValidCoverageWindow = (
  stored: StoredOAuthIngestionState,
  hasCompleteCoverage: boolean,
): boolean => Boolean(
  hasCompleteCoverage
  && Number.isFinite(stored.windowStart?.getTime())
  && Number.isFinite(stored.windowEnd?.getTime())
  && Number.isFinite(stored.windowRecordedAt?.getTime())
  && stored.windowStart
  && stored.windowEnd
  && stored.windowStart < stored.windowEnd,
);

const haveRequiredRangesChanged = (
  stored: StoredOAuthIngestionState,
  required: RequiredSourceRanges,
): boolean =>
  required.historicRange !== stored.historicRange
  || required.futureRange !== stored.futureRange;

const resolveOAuthIngestionState = (
  stored: StoredOAuthIngestionState,
  required: RequiredSourceRanges,
): OAuthIngestionState => {
  const hasCompleteCoverage = hasCompleteCoverageWindow(stored);
  const hasValidWindow = hasValidCoverageWindow(stored, hasCompleteCoverage);
  let coverageState: OAuthIngestionState["coverageState"] = "unverified";
  let fullSyncReason: OAuthIngestionState["fullSyncReason"] = "coverage_missing";
  if (
    hasValidWindow
    && syncRangeSchema.allows(stored.historicRange)
    && syncRangeSchema.allows(stored.futureRange)
  ) {
    coverageState = "verified";
    fullSyncReason = null;
    if (haveRequiredRangesChanged(stored, required)) {
      fullSyncReason = "range_changed";
    } else if (!stored.syncToken) {
      fullSyncReason = "sync_token_missing";
    }
  } else if (hasCompleteCoverage) {
    fullSyncReason = "coverage_invalid";
  }

  let { syncToken } = stored;
  if (fullSyncReason) {
    syncToken = null;
  }
  return {
    authorityChanged: coverageState === "unverified" || fullSyncReason === "range_changed",
    coverageState,
    fullSyncReason,
    syncToken,
  };
};

export { resolveOAuthIngestionState };
export type { OAuthIngestionState, StoredOAuthIngestionState };
