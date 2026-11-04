interface QueuedTask {
  start: () => Promise<void>;
  cancel: () => void;
}

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 60_000;
const BACKOFF_MULTIPLIER = 2;
const DEFAULT_CONCURRENCY = 5;
const INITIAL_ACTIVE_COUNT = 0;
const INITIAL_BACKOFF_UNTIL = 0;
const EMPTY_QUEUE_LENGTH = 0;
const MIN_DELAY = 0;

interface RateLimiterConfig {
  concurrency?: number;
}

const createAbortError = (signal: AbortSignal): Error => {
  let message = "The operation was aborted";
  const { reason } = signal;
  if (reason instanceof Error) {
    ({ message } = reason);
  }
  const error = new Error(message);
  error.name = "AbortError";
  return error;
};

class RateLimiter {
  private readonly concurrency: number;
  private activeCount = INITIAL_ACTIVE_COUNT;
  private queue: QueuedTask[] = [];
  private backoffUntil = INITIAL_BACKOFF_UNTIL;
  private backoffMs: number;

  private readonly initialBackoffMs = INITIAL_BACKOFF_MS;
  private readonly maxBackoffMs = MAX_BACKOFF_MS;
  private readonly backoffMultiplier = BACKOFF_MULTIPLIER;

  constructor(config: RateLimiterConfig = {}) {
    this.concurrency = config.concurrency ?? DEFAULT_CONCURRENCY;
    this.backoffMs = this.initialBackoffMs;
  }

  execute<TResult>(operation: () => Promise<TResult>, signal?: AbortSignal): Promise<TResult> {
    if (signal?.aborted) {
      return Promise.reject(createAbortError(signal));
    }

    const { promise, resolve, reject } = Promise.withResolvers<TResult>();
    let status: "queued" | "active" | "settled" = "queued";
    let abortListener: (() => void) | null = null;

    const cleanup = (): void => {
      if (abortListener) {
        signal?.removeEventListener("abort", abortListener);
        abortListener = null;
      }
    };

    const task: QueuedTask = {
      start: async (): Promise<void> => {
        if (status !== "queued") {
          return;
        }
        status = "active";
        cleanup();

        try {
          const result = await operation();
          this.resetBackoff();
          status = "settled";
          resolve(result);
        } catch (error) {
          status = "settled";
          reject(error);
        }
      },
      cancel: (): void => {
        if (status !== "queued") {
          return;
        }
        status = "settled";
        cleanup();
        const index = this.queue.indexOf(task);
        if (index !== -1) {
          this.queue.splice(index, 1);
        }
        if (signal) {
          reject(createAbortError(signal));
        } else {
          reject(new Error("The operation was aborted"));
        }
        this.processQueue();
      },
    };

    abortListener = (): void => task.cancel();
    signal?.addEventListener("abort", abortListener, { once: true });

    this.queue.push(task);
    this.processQueue();

    return promise;
  }

  reportRateLimit(): void {
    this.backoffUntil = Date.now() + this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * this.backoffMultiplier, this.maxBackoffMs);
    this.scheduleQueueProcessing();
  }

  private resetBackoff(): void {
    if (this.backoffMs !== this.initialBackoffMs) {
      this.backoffMs = this.initialBackoffMs;
    }
  }

  private scheduleQueueProcessing(): void {
    const delay = Math.max(MIN_DELAY, this.backoffUntil - Date.now());

    if (delay > MIN_DELAY) {
      setTimeout(() => this.processQueue(), delay);
    }
  }

  private processQueue(): void {
    if (this.queue.length === EMPTY_QUEUE_LENGTH) {
      return;
    }

    const now = Date.now();
    if (now < this.backoffUntil) {
      this.scheduleQueueProcessing();
      return;
    }

    while (
      this.activeCount < this.concurrency &&
      this.queue.length > EMPTY_QUEUE_LENGTH
    ) {
      const task = this.queue.shift();
      if (!task) {
        break;
      }

      this.activeCount++;
      this.executeTask(task);
    }

    if (this.queue.length > EMPTY_QUEUE_LENGTH) {
      this.scheduleQueueProcessing();
    }
  }

  private async executeTask(task: QueuedTask): Promise<void> {
    try {
      await task.start();
    } finally {
      this.activeCount--;
      this.processQueue();
    }
  }
}

export { RateLimiter };
export type { RateLimiterConfig };
