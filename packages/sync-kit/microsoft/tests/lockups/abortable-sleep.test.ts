import { describe, expect, test } from "vitest";
import { withBackoff } from "../../src/client/backoff";
import { createHarness, operationContext } from "../support/harness";

describe("a backoff sleep is abortable and leaves no timer behind", () => {
  test("MS-L6: aborting during a backoff sleep rejects and clears the timer", async () => {
    const harness = createHarness();
    const caller = new AbortController();
    let attempts = 0;

    const running = withBackoff<string>({
      clock: harness.environment.clock,
      context: operationContext(harness.environment, {
        maxAttempts: 5,
        retryDelayCeilingMs: 5000,
        deadlineMs: 60_000,
      }),
      signal: caller.signal,
      randomFraction: () => 0.5,
      attempt: () => {
        attempts += 1;
        return Promise.resolve({ kind: "retryable", failure: { kind: "throttled", retryAfter: null } });
      },
    });
    await Promise.resolve();
    caller.abort();
    const outcome = await running;

    expect(outcome.kind).toBe("aborted");
    expect(attempts).toBe(1);
    expect(harness.environment.clock.pendingTimers()).toBe(0);
  }, 30_000);
});
