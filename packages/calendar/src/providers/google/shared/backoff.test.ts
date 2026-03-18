import { describe, expect, it, mock } from "bun:test";
import { withBackoff, abortableSleep, computeDelay } from "./backoff";

describe("computeDelay", () => {
  it("returns a delay in the range [2^n * 1000, 2^n * 1000 + 1000] for each attempt", () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const delay = computeDelay(attempt);
      const baseDelay = 2 ** attempt * 1_000;
      expect(delay).toBeGreaterThanOrEqual(baseDelay);
      expect(delay).toBeLessThanOrEqual(baseDelay + 1_000);
    }
  });

  it("caps the delay at 64 seconds", () => {
    const delay = computeDelay(100);
    expect(delay).toBeLessThanOrEqual(64_000);
  });
});

describe("abortableSleep", () => {
  it("resolves after the specified delay", async () => {
    const start = Date.now();
    await abortableSleep(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });

  it("rejects immediately if the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort("cancelled");

    await expect(abortableSleep(10_000, controller.signal)).rejects.toBe("cancelled");
  });

  it("rejects when the signal is aborted during sleep", async () => {
    const controller = new AbortController();
    const sleepPromise = abortableSleep(10_000, controller.signal);

    setTimeout(() => controller.abort("cancelled"), 20);

    await expect(sleepPromise).rejects.toBe("cancelled");
  });

  it("resolves normally when signal is provided but not aborted", async () => {
    const controller = new AbortController();
    await abortableSleep(10, controller.signal);
  });
});

describe("withBackoff", () => {
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

    const result = await withBackoff(operation, {
      maxRetries: 5,
      shouldRetry: (error) => error instanceof Error && error.message === "rate limited",
    });

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

    await expect(
      withBackoff(operation, {
        maxRetries: 2,
        shouldRetry: () => true,
      }),
    ).rejects.toThrow("rate limited");

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

    setTimeout(() => controller.abort("job cancelled"), 50);

    await expect(backoffPromise).rejects.toBe("job cancelled");
    expect(callCount).toBe(1);
  });
});
