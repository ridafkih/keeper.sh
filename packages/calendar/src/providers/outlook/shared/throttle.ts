import { HTTP_STATUS } from "@keeper.sh/constants";

const MAX_RETRY_AFTER_MS = 64_000;
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

const isThrottleStatus = (status: number): boolean =>
  status === HTTP_STATUS.TOO_MANY_REQUESTS || status === HTTP_STATUS.SERVICE_UNAVAILABLE;

const clampRetryAfterMs = (milliseconds: number): number =>
  Math.min(Math.max(milliseconds, 0), MAX_RETRY_AFTER_MS);

const parseRetryAfterMs = (header: string | null): number | null => {
  if (!header) {
    return null;
  }

  const trimmed = header.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) {
    return clampRetryAfterMs(seconds * 1000);
  }

  const retryAt = Date.parse(trimmed);
  if (Number.isNaN(retryAt)) {
    return null;
  }
  return clampRetryAfterMs(retryAt - Date.now());
};

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
