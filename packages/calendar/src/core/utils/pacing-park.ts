/*
 * A deadline abort observed while the caller was parked on keeper-internal
 * pacing — the shared per-host rate-limiter window, the per-user Google
 * limiter, or an account concurrency semaphore — fired before the paced
 * provider request was sent, so the provider was never on the other side of
 * the timeout. The abort reason is flagged in place (never wrapped) so its
 * identity and class are preserved for callers that assert on either, exactly
 * like the serial-flush reserve-abort flag.
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
