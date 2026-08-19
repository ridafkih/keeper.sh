/*
 * A deadline abort observed while parked on keeper-internal pacing fired before the paced
 * request was sent, so the provider was never on the other side of the timeout. Flagged in
 * place, never wrapped, so the reason's identity and class survive for callers.
 */
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
