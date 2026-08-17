import type { CalendarKey, Instant, TimeWindow } from "@keeper.sh/sync-protocol";
import type { ProvenCoverage } from "@keeper.sh/sync-reconcile";
import { secondsBetween } from "../time/epoch";
import {
  compareCanonicalUtcInstants,
  isCanonicalUtcInstant,
  isRecordedInstant,
} from "../time/instant";

interface StoredSourceCoverage {
  readonly calendar: CalendarKey;
  readonly ingestWindowStart: Instant | null;
  readonly ingestWindowEnd: Instant | null;
  readonly ingestWindowRecordedAt: Instant | null;
  readonly historicRange: TimeWindow | null;
  readonly futureRange: TimeWindow | null;
}

const coverageProofRefusals = [
  "noRecordedIngestWindow",
  "noRecordedAxes",
  "unorderedIngestWindow",
  "recordingTooOld",
  "recordedInTheFuture",
  "nonCanonicalInstant",
  "emptyIntersectionWithMirrorWindow",
  "nonContiguousCoverageAxes",
  "localReadIncomplete",
  "siblingSourceUnproven",
] as const;
type CoverageProofRefusal = (typeof coverageProofRefusals)[number];

type SourceCoverageProof =
  | {
      readonly kind: "proven";
      readonly calendar: CalendarKey;
      readonly coverage: Extract<ProvenCoverage, { kind: "proven" }>;
      readonly covered: TimeWindow;
      readonly recordedAt: Instant;
      readonly ageSeconds: number;
    }
  | {
      readonly kind: "unproven";
      readonly calendar: CalendarKey;
      readonly refusal: CoverageProofRefusal;
    };

interface CoverageProofRequest {
  readonly stored: StoredSourceCoverage;
  readonly mirrorWindow: TimeWindow;
  readonly asOf: Instant;
  readonly maxCoverageAgeSeconds: number;
}

const unprovenBecause = (
  calendar: CalendarKey,
  refusal: CoverageProofRefusal,
): SourceCoverageProof => ({ kind: "unproven", calendar, refusal });

const laterOf = (left: Instant, right: Instant): Instant => {
  if (compareCanonicalUtcInstants(left, right) >= 0) {
    return left;
  }
  return right;
};

const earlierOf = (left: Instant, right: Instant): Instant => {
  if (compareCanonicalUtcInstants(left, right) <= 0) {
    return left;
  }
  return right;
};

const isEmptyWindow = (window: TimeWindow): boolean =>
  compareCanonicalUtcInstants(window.start, window.end) >= 0;

const intersectedWith = (axis: TimeWindow, mirrorWindow: TimeWindow): TimeWindow => {
  const start = laterOf(axis.start, mirrorWindow.start);
  const end = earlierOf(axis.end, mirrorWindow.end);
  if (compareCanonicalUtcInstants(start, end) > 0) {
    return { start, end: start };
  }
  return { start, end };
};

const axesAreContiguous = (historic: TimeWindow, future: TimeWindow): boolean =>
  compareCanonicalUtcInstants(historic.end, future.start) >= 0;

const coveredSpanOf = (historic: TimeWindow, future: TimeWindow): TimeWindow | null => {
  if (isEmptyWindow(historic)) {
    return future;
  }
  if (isEmptyWindow(future)) {
    return historic;
  }
  if (!axesAreContiguous(historic, future)) {
    return null;
  }
  return { start: historic.start, end: future.end };
};

const instantsOf = (request: CoverageProofRequest): readonly Instant[] => {
  const { stored, mirrorWindow, asOf } = request;
  return [
    stored.ingestWindowStart,
    stored.ingestWindowEnd,
    stored.ingestWindowRecordedAt,
    stored.historicRange?.start,
    stored.historicRange?.end,
    stored.futureRange?.start,
    stored.futureRange?.end,
    mirrorWindow.start,
    mirrorWindow.end,
    asOf,
  ].filter((instant) => isRecordedInstant(instant));
};

const everyInstantIsCanonical = (request: CoverageProofRequest): boolean =>
  instantsOf(request).every((instant) => isCanonicalUtcInstant(instant));

const sourceCoverageFrom = (request: CoverageProofRequest): SourceCoverageProof => {
  const { stored, mirrorWindow, asOf, maxCoverageAgeSeconds } = request;
  const { calendar, ingestWindowStart, ingestWindowEnd, ingestWindowRecordedAt } = stored;
  if (!ingestWindowStart || !ingestWindowEnd || !ingestWindowRecordedAt) {
    return unprovenBecause(calendar, "noRecordedIngestWindow");
  }
  if (!stored.historicRange || !stored.futureRange) {
    return unprovenBecause(calendar, "noRecordedAxes");
  }
  if (!everyInstantIsCanonical(request)) {
    return unprovenBecause(calendar, "nonCanonicalInstant");
  }
  if (compareCanonicalUtcInstants(ingestWindowStart, ingestWindowEnd) > 0) {
    return unprovenBecause(calendar, "unorderedIngestWindow");
  }
  if (compareCanonicalUtcInstants(ingestWindowRecordedAt, asOf) > 0) {
    return unprovenBecause(calendar, "recordedInTheFuture");
  }
  const ageSeconds = secondsBetween(ingestWindowRecordedAt, asOf);
  if (ageSeconds > maxCoverageAgeSeconds) {
    return unprovenBecause(calendar, "recordingTooOld");
  }
  const ingested = { start: ingestWindowStart, end: ingestWindowEnd };
  const readable = intersectedWith(ingested, mirrorWindow);
  const historic = intersectedWith(stored.historicRange, readable);
  const future = intersectedWith(stored.futureRange, readable);
  if (isEmptyWindow(historic) && isEmptyWindow(future)) {
    return unprovenBecause(calendar, "emptyIntersectionWithMirrorWindow");
  }
  const covered = coveredSpanOf(historic, future);
  if (!covered) {
    return unprovenBecause(calendar, "nonContiguousCoverageAxes");
  }
  return {
    kind: "proven",
    calendar,
    coverage: { kind: "proven", calendar, historic, future },
    covered,
    recordedAt: ingestWindowRecordedAt,
    ageSeconds,
  };
};

export { coverageProofRefusals, sourceCoverageFrom };
export type {
  CoverageProofRefusal,
  CoverageProofRequest,
  SourceCoverageProof,
  StoredSourceCoverage,
};
