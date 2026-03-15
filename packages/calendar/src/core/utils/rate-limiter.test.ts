import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "bun:test";
import { RateLimiter } from "./rate-limiter";

const sleep = (milliseconds: number): Promise<void> => Bun.sleep(milliseconds);
const resolveValue = <TValue>(value: TValue): Promise<TValue> => {
  const { promise, resolve } = Promise.withResolvers<TValue>();
  resolve(value);
  return promise;
};
const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};
const readNumericField = (target: object, fieldName: string): number => {
  const value = Reflect.get(target, fieldName);
  if (typeof value !== "number") {
    throw new TypeError(`Expected '${fieldName}' to be numeric`);
  }
  return value;
};

describe("RateLimiter", () => {
  describe("execute", () => {
    it("resolves with the operation result", async () => {
      const limiter = new RateLimiter();
      const result = await limiter.execute(() => Promise.resolve("hello"));
      expect(result).toBe("hello");
    });

    it("rejects when the operation throws", () => {
      const limiter = new RateLimiter();
      const error = new Error("boom");

      expect(limiter.execute(() => Promise.reject(error))).rejects.toThrow("boom");
    });

    it("runs operations concurrently up to the concurrency limit", async () => {
      const limiter = new RateLimiter({ concurrency: 2 });
      let concurrentCount = 0;
      let maxConcurrent = 0;

      const createTask = () =>
        limiter.execute(async () => {
          concurrentCount++;
          maxConcurrent = Math.max(maxConcurrent, concurrentCount);
          await sleep(50);
          concurrentCount--;
        });

      await Promise.all([createTask(), createTask(), createTask(), createTask()]);

      expect(maxConcurrent).toBe(2);
    });

    it("processes queued tasks after earlier tasks complete", async () => {
      const limiter = new RateLimiter({ concurrency: 1 });
      const order: number[] = [];

      const task1 = limiter.execute(async () => {
        await sleep(20);
        order.push(1);
      });

      const task2 = limiter.execute(() => {
        order.push(2);
        return Promise.resolve();
      });

      await Promise.all([task1, task2]);
      expect(order).toEqual([1, 2]);
    });
  });

  describe("rate limiting", () => {
    it("respects requestsPerMinute by delaying excess requests", async () => {
      const limiter = new RateLimiter({ concurrency: 10, requestsPerMinute: 2 });
      const timestamps: number[] = [];

      const createTask = () =>
        limiter.execute(() => {
          timestamps.push(Date.now());
          return Promise.resolve();
        });

      await Promise.all([createTask(), createTask()]);

      expect(timestamps).toHaveLength(2);
    });
  });

  describe("reportRateLimit", () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("delays subsequent requests after a rate limit is reported", async () => {
      const limiter = new RateLimiter({ concurrency: 1 });

      await limiter.execute(() => Promise.resolve("first"));

      limiter.reportRateLimit();

      let didComplete = false;
      const secondOperation = limiter.execute(() => resolveValue("second"));
      const trackedSecondOperation = secondOperation.then((result) => {
        didComplete = true;
        return result;
      });

      await flushMicrotasks();
      expect(didComplete).toBe(false);

      jest.advanceTimersByTime(999);
      await flushMicrotasks();
      expect(didComplete).toBe(false);

      jest.advanceTimersByTime(1);
      await trackedSecondOperation;
      expect(didComplete).toBe(true);
    });

    it("resets backoff after a successful operation", async () => {
      const limiter = new RateLimiter({ concurrency: 1 });

      await limiter.execute(() => Promise.resolve("warmup"));
      limiter.reportRateLimit();

      const backoffOperation = limiter.execute(() => Promise.resolve("after-backoff"));
      jest.advanceTimersByTime(1000);
      await backoffOperation;

      let didComplete = false;
      const fastOperation = limiter.execute(() => resolveValue("should-be-fast"));
      const trackedFastOperation = fastOperation.then((result) => {
        didComplete = true;
        return result;
      });

      await flushMicrotasks();
      expect(didComplete).toBe(true);
      await trackedFastOperation;
    });

    it("doubles backoff on consecutive rate limits up to the maximum", async () => {
      const limiter = new RateLimiter({ concurrency: 1 });

      await limiter.execute(() => Promise.resolve("warmup"));

      const firstTimestamp = Date.now();
      limiter.reportRateLimit();
      expect(readNumericField(limiter, "backoffUntil") - firstTimestamp).toBe(1000);
      expect(readNumericField(limiter, "backoffMs")).toBe(2000);

      const secondTimestamp = Date.now();
      limiter.reportRateLimit();
      expect(readNumericField(limiter, "backoffUntil") - secondTimestamp).toBe(2000);
      expect(readNumericField(limiter, "backoffMs")).toBe(4000);
    });
  });
});
