import { describe, expect, test } from "vitest";
import { createAttemptBudget } from "../../src/client/attempt-budget";
import { withBackoff } from "../../src/client/backoff";
import { createHarness, operationContext } from "../support/harness";
import { filesMatchingPattern } from "../support/sources";

describe("every sleep is the injected clock's, which fake timers can hold", () => {
  test("DAV-H16: no src or test file calls Bun.sleep", async () => {
    const inSource = await filesMatchingPattern("src", /Bun\.sleep\(/);
    const inTests = await filesMatchingPattern("tests", /Bun\.sleep\(/);

    expect(inSource).toEqual([]);
    expect(inTests).toEqual([]);
  });

  test("DAV-H16: the backoff sleeps on the injected clock and nothing else", async () => {
    const harness = createHarness();
    const slept: number[] = [];
    const clock = {
      now: harness.environment.clock.now,
      sleep: (milliseconds: number, signal: AbortSignal): Promise<void> => {
        slept.push(milliseconds);
        return harness.environment.clock.sleep(milliseconds, signal);
      },
    };

    await withBackoff<string>({
      clock,
      context: operationContext(harness.environment, {
        maxAttempts: 2,
        retryDelayCeilingMs: 5,
        deadlineMs: 2000,
      }),
      signal: new AbortController().signal,
      attempts: createAttemptBudget(2),
      randomFraction: () => 1,
      attempt: () =>
        Promise.resolve({ kind: "retryable", failure: { kind: "transient", status: 503 } }),
    });

    expect(slept.length).toBe(1);
  }, 30_000);
});
