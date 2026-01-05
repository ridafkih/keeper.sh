type QueuedTask = () => Promise<void>;

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 60_000;
const BACKOFF_MULTIPLIER = 2;
const DEFAULT_CONCURRENCY = 5;
const DEFAULT_REQUESTS_PER_MINUTE = 600;
const MS_PER_MINUTE = 60_000;
const INITIAL_ACTIVE_COUNT = 0;
const INITIAL_BACKOFF_UNTIL = 0;
const EMPTY_QUEUE_LENGTH = 0;
const MIN_DELAY = 0;
const FIRST_TIMESTAMP_INDEX = 0;

interface RateLimiterConfig {
  concurrency?: number;
  requestsPerMinute?: number;
}

class RateLimiter {
  private readonly concurrency: number;
  private readonly requestsPerMinute: number;
  private activeCount = INITIAL_ACTIVE_COUNT;
  private queue: QueuedTask[] = [];
  private backoffUntil = INITIAL_BACKOFF_UNTIL;
  private backoffMs: number;
  private requestTimestamps: number[] = [];

  private readonly initialBackoffMs = INITIAL_BACKOFF_MS;
  private readonly maxBackoffMs = MAX_BACKOFF_MS;
  private readonly backoffMultiplier = BACKOFF_MULTIPLIER;

  constructor(config: RateLimiterConfig = {}) {
    this.concurrency = config.concurrency ?? DEFAULT_CONCURRENCY;
    this.requestsPerMinute = config.requestsPerMinute ?? DEFAULT_REQUESTS_PER_MINUTE;
    this.backoffMs = this.initialBackoffMs;
  }

  execute<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
    const { promise, resolve, reject } = Promise.withResolvers<TResult>();

    const task: QueuedTask = async (): Promise<void> => {
      try {
        const result = await operation();
        this.resetBackoff();
        resolve(result);
      } catch (error) {
        reject(error);
      }
    };

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

  private getFirstTimestamp(): number | null {
    if (this.requestTimestamps.length === EMPTY_QUEUE_LENGTH) {
      return null;
    }
    return this.requestTimestamps[FIRST_TIMESTAMP_INDEX] ?? null;
  }

  private pruneOldTimestamps(): void {
    const cutoff = Date.now() - MS_PER_MINUTE;
    let firstTimestamp = this.getFirstTimestamp();
    while (firstTimestamp !== null && firstTimestamp < cutoff) {
      this.requestTimestamps.shift();
      firstTimestamp = this.getFirstTimestamp();
    }
  }

  private canMakeRequest(): boolean {
    this.pruneOldTimestamps();
    return this.requestTimestamps.length < this.requestsPerMinute;
  }

  private getDelayUntilNextSlot(): number {
    if (this.requestTimestamps.length < this.requestsPerMinute) {
      return MIN_DELAY;
    }
    const oldestTimestamp = this.getFirstTimestamp();
    if (oldestTimestamp === null) {
      return MIN_DELAY;
    }
    return oldestTimestamp + MS_PER_MINUTE - Date.now();
  }

  private recordRequest(): void {
    this.requestTimestamps.push(Date.now());
  }

  private scheduleQueueProcessing(): void {
    const backoffDelay = Math.max(MIN_DELAY, this.backoffUntil - Date.now());
    const rateLimitDelay = this.getDelayUntilNextSlot();
    const delay = Math.max(backoffDelay, rateLimitDelay);

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

    if (!this.canMakeRequest()) {
      this.scheduleQueueProcessing();
      return;
    }

    while (
      this.activeCount < this.concurrency &&
      this.queue.length > EMPTY_QUEUE_LENGTH &&
      this.canMakeRequest()
    ) {
      const task = this.queue.shift();
      if (!task) {
        break;
      }

      this.activeCount++;
      this.recordRequest();
      this.executeTask(task);
    }

    if (this.queue.length > EMPTY_QUEUE_LENGTH) {
      this.scheduleQueueProcessing();
    }
  }

  private executeTask(task: QueuedTask): void {
    task()
      .finally(() => {
        this.activeCount--;
        this.processQueue();
      })
      .catch(() => null);
  }
}

export { RateLimiter };
export type { RateLimiterConfig };
