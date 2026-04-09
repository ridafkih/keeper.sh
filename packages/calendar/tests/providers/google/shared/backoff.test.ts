import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withBackoff, abortableSleep, computeDelay } from "../../../../src/providers/google/shared/backoff";

const flushAsync = async (): Promise<void> => {
  for (let tick = 0; tick < 5; tick++) {
    await Promise.resolve();
  }
};

const advanceBackoff = async (): Promise<void> => {
  vi.advanceTimersByTime(65_000);
  await flushAsync();
};

describe("computeDelay", () => {
  it("returns a delay in the range [2^n * 1000, 2^n * 1000 + 1000] for each attempt", () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const delay = computeDelay(attempt);
      const baseDelay = 2 ** attempt * 1000;
      expect(delay).toBeGreaterThanOrEqual(baseDelay);
      expect(delay).toBeLessThanOrEqual(baseDelay + 1000);
    }
  });

  it("caps the delay at 64 seconds", () => {
    const delay = computeDelay(100);
    expect(delay).toBeLessThanOrEqual(64_000);
  });
});

describe("abortableSleep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves after the specified delay", async () => {
    const promise = abortableSleep(50);
    vi.advanceTimersByTime(50);
    await promise;
  });

  it("rejects immediately if the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort("cancelled");

    await expect(abortableSleep(10_000, controller.signal)).rejects.toBe("cancelled");
  });

  it("rejects when the signal is aborted during sleep", async () => {
    const controller = new AbortController();
    const sleepPromise = abortableSleep(10_000, controller.signal);

    controller.abort("cancelled");

    await expect(sleepPromise).rejects.toBe("cancelled");
  });

  it("resolves normally when signal is provided but not aborted", async () => {
    const controller = new AbortController();
    const promise = abortableSleep(10, controller.signal);
    vi.advanceTimersByTime(10);
    await promise;
  });
});

describe("withBackoff", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the result on first success", async () => {
    const result = await withBackoff(
      () => Promise.resolve("ok"),
      { shouldRetry: () => true },
    );

    expect(result).toBe("ok");
  });

  it("retries on retryable errors and eventually succeeds", async () => {
    let callCount = 0;
    const operation = () => {
      callCount++;
      if (callCount < 3) {
        return Promise.reject(new Error("rate limited"));
      }
      return Promise.resolve("recovered");
    };

    const promise = withBackoff(operation, {
      maxRetries: 5,
      shouldRetry: (error) => error instanceof Error && error.message === "rate limited",
    });

    await advanceBackoff();
    await advanceBackoff();

    const result = await promise;

    expect(result).toBe("recovered");
    expect(callCount).toBe(3);
  });

  it("throws immediately for non-retryable errors", async () => {
    let callCount = 0;
    const operation = () => {
      callCount++;
      return Promise.reject(new Error("auth failed"));
    };

    await expect(
      withBackoff(operation, {
        shouldRetry: (error) => error instanceof Error && error.message === "rate limited",
      }),
    ).rejects.toThrow("auth failed");

    expect(callCount).toBe(1);
  });

  it("throws after exhausting all retries", async () => {
    let callCount = 0;
    const operation = () => {
      callCount++;
      return Promise.reject(new Error("rate limited"));
    };

    const promise = withBackoff(operation, {
      maxRetries: 2,
      shouldRetry: () => true,
    });

    await advanceBackoff();
    await advanceBackoff();

    await expect(promise).rejects.toThrow("rate limited");

    expect(callCount).toBe(3);
  });

  it("aborts during backoff sleep when signal is triggered", async () => {
    const controller = new AbortController();
    let callCount = 0;

    const operation = () => {
      callCount++;
      return Promise.reject(new Error("rate limited"));
    };

    const backoffPromise = withBackoff(operation, {
      maxRetries: 5,
      signal: controller.signal,
      shouldRetry: () => true,
    });

    await flushAsync();
    controller.abort("job cancelled");

    await expect(backoffPromise).rejects.toBe("job cancelled");
    expect(callCount).toBe(1);
  });
});
