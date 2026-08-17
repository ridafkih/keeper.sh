import type { CoverageWindow, Instant, ListingScope, TimeWindow } from "@keeper.sh/sync-protocol";
import { microsoftLimits } from "../limits";

const instantAt = (milliseconds: number): Instant => ({
  kind: "instant",
  value: new Date(milliseconds).toISOString(),
});

const clampedEnd = (walked: TimeWindow): Instant => {
  const from = Date.parse(walked.start.value);
  const until = Date.parse(walked.end.value);
  if (until <= from) {
    return walked.start;
  }
  if (until - from <= microsoftLimits.maximumCoverageMs) {
    return walked.end;
  }
  return instantAt(from + microsoftLimits.maximumCoverageMs);
};

const provenCoverage = (scope: ListingScope, walked: TimeWindow): CoverageWindow => ({
  covered: { start: walked.start, end: clampedEnd(walked) },
  calendar: scope.calendar,
});

export { provenCoverage };
