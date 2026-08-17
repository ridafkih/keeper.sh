import type { CoverageWindow, ListingScope, TimeWindow } from "@keeper.sh/sync-protocol";
import { caldavLimits } from "../limits";

interface ReadCompleteness {
  readonly listedCount: number;
  readonly requestedCount: number;
  readonly readCount: number;
}

const wholeCollectionRead = (completeness: ReadCompleteness): boolean =>
  completeness.requestedCount === completeness.listedCount &&
  completeness.readCount === completeness.listedCount;

const attestableWindow = (window: TimeWindow): TimeWindow => {
  const start = Date.parse(window.start.value);
  const end = Date.parse(window.end.value);
  if (end <= start) {
    return { start: window.start, end: window.start };
  }
  if (end - start <= caldavLimits.coverageHorizonMs) {
    return window;
  }
  return {
    start: window.start,
    end: { kind: "instant", value: new Date(start + caldavLimits.coverageHorizonMs).toISOString() },
  };
};

const coverageOver = (scope: ListingScope): CoverageWindow => ({
  covered: attestableWindow(scope.window),
  calendar: scope.calendar,
});

const provenCoverage = (
  scope: ListingScope,
  completeness: ReadCompleteness,
): CoverageWindow | null => {
  if (!wholeCollectionRead(completeness)) {
    return null;
  }
  return coverageOver(scope);
};

export { attestableWindow, coverageOver, provenCoverage };
export type { ReadCompleteness };
