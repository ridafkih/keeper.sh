const PACING_PARK_ABORT_FLAG = "ingestPacingParkAborted";

const flagPacingParkAbortReason = (reason: unknown): void => {
  if (reason instanceof Error) {
    Object.assign(reason, { [PACING_PARK_ABORT_FLAG]: true });
  }
};

const isIngestPacingParkAbortError = (error: unknown): boolean =>
  error instanceof Error
  && (error as Error & Record<string, unknown>)[PACING_PARK_ABORT_FLAG] === true;

export { flagPacingParkAbortReason, isIngestPacingParkAbortError };
