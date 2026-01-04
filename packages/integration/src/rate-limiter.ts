type QueuedTask = () => Promise<void>;

export class RateLimiter {
  private readonly concurrency: number;
  private activeCount = 0;
  private queue: QueuedTask[] = [];
  private backoffUntil = 0;
  private backoffMs: number;

  private readonly initialBackoffMs = 1000;
  private readonly maxBackoffMs = 60000;
  private readonly backoffMultiplier = 2;

  constructor(concurrency = 5) {
    this.concurrency = concurrency;
    this.backoffMs = this.initialBackoffMs;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const task: QueuedTask = async () => {
        try {
          const result = await fn();
          this.resetBackoff();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      };
      this.queue.push(task);
      this.processQueue();
    });
  }

  reportRateLimit(): void {
    this.backoffUntil = Date.now() + this.backoffMs;
    this.backoffMs = Math.min(
      this.backoffMs * this.backoffMultiplier,
      this.maxBackoffMs,
    );
    this.scheduleQueueProcessing();
  }

  private resetBackoff(): void {
    if (this.backoffMs !== this.initialBackoffMs) {
      this.backoffMs = this.initialBackoffMs;
    }
  }

  private scheduleQueueProcessing(): void {
    const delay = Math.max(0, this.backoffUntil - Date.now());
    if (delay > 0) {
      setTimeout(() => this.processQueue(), delay);
    }
  }

  private processQueue(): void {
    if (this.queue.length === 0) return;

    const now = Date.now();
    if (now < this.backoffUntil) {
      return;
    }

    while (this.activeCount < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task) break;

      this.activeCount++;
      this.executeTask(task);
    }
  }

  private async executeTask(task: QueuedTask): Promise<void> {
    try {
      await task();
    } finally {
      this.activeCount--;
      this.processQueue();
    }
  }
}
