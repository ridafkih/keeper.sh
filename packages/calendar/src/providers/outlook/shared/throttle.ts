import { isThrottleStatus, parseRetryAfterMs } from "../../../core/utils/retry-after";

const OUTLOOK_MAX_THROTTLE_RETRIES = 5;

/*
 * Graph reports mailbox throttling as 429 and, for MailboxConcurrency, as 503 with a
 * Retry-After header. Both are transient and the same occurrence succeeds on a retry.
 */
class OutlookThrottledError extends Error {
  public readonly status: number;
  public readonly retryAfterMs: number | null;

  constructor(status: number, retryAfterMs: number | null, message: string) {
    super(message);
    this.name = "OutlookThrottledError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

const isThrottledError = (error: unknown): error is OutlookThrottledError =>
  error instanceof OutlookThrottledError;

const getThrottleRetryDelayMs = (error: unknown): number | null => {
  if (!isThrottledError(error)) {
    return null;
  }
  return error.retryAfterMs;
};

export {
  getThrottleRetryDelayMs,
  isThrottledError,
  isThrottleStatus,
  OUTLOOK_MAX_THROTTLE_RETRIES,
  OutlookThrottledError,
  parseRetryAfterMs,
};
