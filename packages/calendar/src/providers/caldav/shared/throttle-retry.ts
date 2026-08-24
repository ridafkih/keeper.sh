import { widelog } from "widelogger";
import { measureSegment } from "../../../core/telemetry/segments";
import { isThrottleStatus, MAX_RETRY_AFTER_MS, parseRetryAfterMs } from "../../../core/utils/retry-after";

const CALDAV_MAX_THROTTLE_RETRIES = 3;

/*
 * Apple's advertised retry interval is routinely shorter than the throttle it is reporting,
 * so obeying it exactly re-trips the throttle and spends another request finding out. The
 * floor grows per attempt and the header only ever moves the wait later, never sooner.
 */
const CALDAV_THROTTLE_FLOOR_MS = 2000;

const resolveThrottleDelayMs = (retryAfterMs: number | null, attempt: number): number => {
  const floor = CALDAV_THROTTLE_FLOOR_MS * 2 ** attempt;
  return Math.min(Math.max(floor, retryAfterMs ?? 0), MAX_RETRY_AFTER_MS);
};

const isRetryAfterHonoured = (retryAfterMs: number | null, delayMs: number): boolean => {
  if (retryAfterMs === null) {
    return false;
  }
  return Math.min(retryAfterMs, MAX_RETRY_AFTER_MS) === delayMs;
};

const recordThrottle = (retryAfterMs: number | null, delayMs: number): void => {
  widelog.count("ratelimit.provider_throttle_count", 1);
  widelog.count("ratelimit.throttle_wait_ms", delayMs);
  if (isRetryAfterHonoured(retryAfterMs, delayMs)) {
    widelog.count("ratelimit.retry_after_honoured_count", 1);
    return;
  }
  widelog.count("ratelimit.throttle_floor_count", 1);
};

interface ThrottleRetryOptions {
  sleep: (milliseconds: number, signal?: AbortSignal | null) => Promise<void>;
  signal?: AbortSignal | null;
}

/*
 * A replayed request needs its own body, and a Request that has already been sent no longer
 * has one, so each attempt gets a clone taken before the send.
 */
const cloneAttempt = <TInput>(input: TInput): TInput => {
  if (input instanceof Request) {
    return input.clone() as TInput;
  }
  return input;
};

const fetchHonouringRetryAfter = async <TInput>(
  send: (input: TInput) => Promise<Response>,
  input: TInput,
  options: ThrottleRetryOptions,
): Promise<Response> => {
  let response = await send(cloneAttempt(input));

  for (let attempt = 0; attempt < CALDAV_MAX_THROTTLE_RETRIES; attempt++) {
    if (!isThrottleStatus(response.status)) {
      return response;
    }

    const retryAfterMs = parseRetryAfterMs(response.headers.get("Retry-After"));
    const delayMs = resolveThrottleDelayMs(retryAfterMs, attempt);
    recordThrottle(retryAfterMs, delayMs);
    await response.body?.cancel();
    await measureSegment(
      "wait.provider_retry_ms",
      () => options.sleep(delayMs, options.signal),
    );
    response = await send(cloneAttempt(input));
  }

  return response;
};

export {
  CALDAV_MAX_THROTTLE_RETRIES,
  CALDAV_THROTTLE_FLOOR_MS,
  fetchHonouringRetryAfter,
  resolveThrottleDelayMs,
};
