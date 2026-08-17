import type { CalendarKey, CoverageWindow, Instant, TimeWindow } from "@keeper.sh/sync-protocol";
import { googleListingLimits } from "../limits";

const instantAt = (milliseconds: number): Instant => ({
  kind: "instant",
  value: new Date(milliseconds).toISOString(),
});

const clampedEnd = (requested: TimeWindow): Instant => {
  const from = Date.parse(requested.start.value);
  const until = Date.parse(requested.end.value);
  if (until <= from) {
    return requested.start;
  }
  if (until - from <= googleListingLimits.maximumCoverageMs) {
    return requested.end;
  }
  return instantAt(from + googleListingLimits.maximumCoverageMs);
};

const provenCoverage = (requested: TimeWindow, calendar: CalendarKey): CoverageWindow => ({
  covered: { start: requested.start, end: clampedEnd(requested) },
  calendar,
});

export { provenCoverage };
