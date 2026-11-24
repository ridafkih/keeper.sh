import { HTTP_STATUS } from "@keeper.sh/constants";

const MAX_RETRY_AFTER_MS = 64_000;

const isThrottleStatus = (status: number): boolean =>
  status === HTTP_STATUS.TOO_MANY_REQUESTS || status === HTTP_STATUS.SERVICE_UNAVAILABLE;

const clampRetryAfterMs = (milliseconds: number, maximumMs: number = MAX_RETRY_AFTER_MS): number =>
  Math.min(Math.max(milliseconds, 0), maximumMs);

const parseRetryAfterMs = (header: string | null, maximumMs: number = MAX_RETRY_AFTER_MS): number | null => {
  if (!header) {
    return null;
  }

  const trimmed = header.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) {
    return clampRetryAfterMs(seconds * 1000, maximumMs);
  }

  const retryAt = Date.parse(trimmed);
  if (Number.isNaN(retryAt)) {
    return null;
  }
  return clampRetryAfterMs(retryAt - Date.now(), maximumMs);
};

export { clampRetryAfterMs, isThrottleStatus, MAX_RETRY_AFTER_MS, parseRetryAfterMs };
