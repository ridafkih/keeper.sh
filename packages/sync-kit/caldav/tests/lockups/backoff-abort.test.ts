import { describe, expect, test } from "vitest";
import { createAttemptBudget } from "../../src/client/attempt-budget";
import { withBackoff } from "../../src/client/backoff";
import { createHarness, operationContext } from "../support/harness";

const HANG_TIMEOUT = 30_000;

describe("a cancelled job does not sleep out its backoff", () => {
  test("DAV-L17: an abort mid-sleep rejects immediately", async () => {
    const harness = createHarness();
    const caller = new AbortController();
    let attempts = 0;

    const running = withBackoff<string>({
      clock: harness.environment.clock,
      context: operationContext(harness.environment, {
        maxAttempts: 5,
        retryDelayCeilingMs: 5000,
        deadlineMs: 10_000,
      }),
      signal: caller.signal,
      attempts: createAttemptBudget(5),
      randomFraction: () => 1,
      attempt: () => {
        attempts += 1;
        return Promise.resolve({
          kind: "retryable",
          failure: { kind: "transient", status: 503 },
        });
      },
    });
    await Promise.resolve();
    caller.abort();

    expect(await running).toEqual({ kind: "aborted" });
    expect(attempts).toBe(1);
    expect(harness.environment.clock.pendingTimers()).toBe(0);
  }, HANG_TIMEOUT);

  test("DAV-L17: an abort raised before the first attempt runs no attempt at all", async () => {
    const harness = createHarness();
    const caller = new AbortController();
    caller.abort();
    let attempts = 0;

    const outcome = await withBackoff<string>({
      clock: harness.environment.clock,
      context: operationContext(harness.environment, { maxAttempts: 3 }),
      attempts: createAttemptBudget(3),
      signal: caller.signal,
      randomFraction: () => 1,
      attempt: () => {
        attempts += 1;
        return Promise.resolve({ kind: "answered", value: "should not run" });
      },
    });

    expect(outcome).toEqual({ kind: "aborted" });
    expect(attempts).toBe(0);
  }, HANG_TIMEOUT);
});
