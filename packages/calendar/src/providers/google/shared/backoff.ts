const MAX_JITTER_MS = 1_000;
const MAX_BACKOFF_MS = 64_000;
const DEFAULT_MAX_RETRIES = 5;
const BACKOFF_MULTIPLIER = 2;

const computeDelay = (attempt: number): number => {
  const baseDelay = BACKOFF_MULTIPLIER ** attempt * 1_000;
  const jitter = Math.random() * MAX_JITTER_MS;
  return Math.min(baseDelay + jitter, MAX_BACKOFF_MS);
};

const abortableSleep = (delayMs: number, signal?: AbortSignal): Promise<void> => {
  if (signal?.aborted) {
    return Promise.reject(signal.reason);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
};

interface BackoffOptions {
  maxRetries?: number;
  signal?: AbortSignal;
  shouldRetry: (error: unknown) => boolean;
}

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
      await abortableSleep(computeDelay(attempt), options.signal);
    }
  }

  throw new Error("Unreachable: backoff loop exited without returning or throwing");
};

export { withBackoff, abortableSleep, computeDelay, DEFAULT_MAX_RETRIES };
export type { BackoffOptions };
