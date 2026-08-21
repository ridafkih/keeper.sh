const INGEST_BASELINE_MOVED_SLUG = "ingest-baseline-moved";

class IngestBaselineMovedError extends Error {
  readonly calendarId: string;
  readonly expectedIngestSeq: number;
  readonly observedIngestSeq: number;

  constructor(calendarId: string, expectedIngestSeq: number, observedIngestSeq: number) {
    super(
      `Calendar ${calendarId} ingest baseline moved from ${expectedIngestSeq} to ${observedIngestSeq}`,
    );
    this.name = "IngestBaselineMovedError";
    this.calendarId = calendarId;
    this.expectedIngestSeq = expectedIngestSeq;
    this.observedIngestSeq = observedIngestSeq;
  }
}

class IngestBaselineMovedAbortError extends Error {
  readonly calendarIds: string[];

  constructor(calendarIds: string[]) {
    super(`Ingest aborted on a moved baseline for ${calendarIds.join(", ")}`);
    this.name = "IngestBaselineMovedAbortError";
    this.calendarIds = calendarIds;
  }
}

const isIngestBaselineMovedError = (error: unknown): error is IngestBaselineMovedError =>
  error instanceof IngestBaselineMovedError;

export {
  INGEST_BASELINE_MOVED_SLUG,
  IngestBaselineMovedAbortError,
  IngestBaselineMovedError,
  isIngestBaselineMovedError,
};
