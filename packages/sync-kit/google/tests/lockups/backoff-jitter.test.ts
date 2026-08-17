import { describe, expect, test } from "vitest";
import { jitteredMs, retryDelayMs, withBackoff } from "../../src/client/backoff";
import { createHarness, operationContext } from "../support/harness";

const rateLimited = { kind: "rateLimited", retryAfter: null } as const;

describe("a retry delay is jittered, capped, and never mislabels a refusal", () => {
  test("GOOG-L3: the jitter spreads the delay without exceeding it", () => {
    expect(jitteredMs(1000, 0)).toBe(500);
    expect(jitteredMs(1000, 1)).toBe(1000);
    expect(jitteredMs(1000, 2)).toBe(1000);
    expect(jitteredMs(1000, -1)).toBe(500);
  });

  test("GOOG-L3: two workers drawing different fractions do not retry in lockstep", () => {
    const harness = createHarness();
    const context = operationContext(harness.environment, { retryDelayCeilingMs: 10_000 });

    const first = retryDelayMs(rateLimited, {
      clock: harness.environment.clock,
      context,
      randomFraction: () => 0,
    }, 3);
    const second = retryDelayMs(rateLimited, {
      clock: harness.environment.clock,
      context,
      randomFraction: () => 1,
    }, 3);

    expect(first).not.toBe(second);
    expect(first).toBeLessThan(second);
  });

  test("GOOG-L3: a sleep that rejects for its own reasons is a failure, never a caller abort", async () => {
    const harness = createHarness();
    const context = operationContext(harness.environment, { maxAttempts: 3 });

    const outcome = await withBackoff<string>({
      clock: {
        now: harness.environment.clock.now,
        sleep: () => Promise.reject(new Error("this clock refuses negative delays")),
      },
      context,
      signal: new AbortController().signal,
      randomFraction: () => 0.5,
      attempt: () => Promise.resolve({ kind: "retryable", failure: rateLimited }),
    });

    expect(outcome.kind).toBe("failed");
  });

  test("GOOG-L3: a sleep interrupted by the caller's signal is reported as an abort", async () => {
    const harness = createHarness();
    const aborting = new AbortController();
    const context = operationContext(harness.environment, { maxAttempts: 3 });

    const outcome = await withBackoff<string>({
      clock: {
        now: harness.environment.clock.now,
        sleep: () => {
          aborting.abort();
          return Promise.reject(new Error("aborted"));
        },
      },
      context,
      signal: aborting.signal,
      randomFraction: () => 0.5,
      attempt: () => Promise.resolve({ kind: "retryable", failure: rateLimited }),
    });

    expect(outcome.kind).toBe("aborted");
  });
});
