import { widelog } from "widelogger";
import { measureSegment } from "../telemetry/segments";

const MAX_JITTER_MS = 1000;
const MAX_BACKOFF_MS = 64_000;
const DEFAULT_MAX_RETRIES = 5;
const BACKOFF_MULTIPLIER = 2;

const computeDelay = (attempt: number): number => {
  const baseDelay = BACKOFF_MULTIPLIER ** attempt * 1000;
  const jitter = Math.random() * MAX_JITTER_MS;
  return Math.min(baseDelay + jitter, MAX_BACKOFF_MS);
};

const createAbortableTimer = (
  delayMs: number,
  signal: AbortSignal,
  resolve: () => void,
  reject: (reason: unknown) => void,
): void => {
  const controller = new AbortController();

  const onAbort = () => {
    controller.abort();
    reject(signal.reason);
  };

  const onTimeout = () => {
    signal.removeEventListener("abort", onAbort);
    resolve();
  };

  signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(onTimeout, delayMs);
  controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
};

const abortableSleep = (delayMs: number, signal?: AbortSignal): Promise<void> => {
  if (signal?.aborted) {
    return Promise.reject(signal.reason);
  }
  if (!signal) {
    return new Promise((resolve) => { setTimeout(resolve, delayMs); });
  }
  return new Promise((resolve, reject) => {
    createAbortableTimer(delayMs, signal, resolve, reject);
  });
};

interface BackoffRetry {
  attempt: number;
  delayMs: number;
  error: unknown;
}

interface BackoffOptions {
  maxRetries?: number;
  signal?: AbortSignal;
  shouldRetry: (error: unknown) => boolean;
  // A provider that tells us how long to wait knows better than the exponential curve does.
  getRetryDelayMs?: (error: unknown) => number | null;
  onRetry?: (retry: BackoffRetry) => void;
}

const resolveRetryDelayMs = (
  options: BackoffOptions,
  error: unknown,
  attempt: number,
): number => {
  const providedDelayMs = options.getRetryDelayMs?.(error) ?? null;
  if (providedDelayMs === null) {
    return computeDelay(attempt);
  }
  return Math.min(providedDelayMs, MAX_BACKOFF_MS);
};

const withBackoff = async <TResult>(
  operation: () => Promise<TResult>,
  options: BackoffOptions,
): Promise<TResult> => {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const isLastAttempt = attempt === maxRetries;
      if (isLastAttempt || !options.shouldRetry(error)) {
        throw error;
      }
      const delayMs = resolveRetryDelayMs(options, error, attempt);
      widelog.count("provider.retry_count", 1);
      options.onRetry?.({ attempt, delayMs, error });
      await measureSegment(
        "wait.provider_retry_ms",
        () => abortableSleep(delayMs, options.signal),
      );
    }
  }

  throw new Error("Unreachable: backoff loop exited without returning or throwing");
};

export { withBackoff, abortableSleep, computeDelay, DEFAULT_MAX_RETRIES };
export type { BackoffOptions, BackoffRetry };
