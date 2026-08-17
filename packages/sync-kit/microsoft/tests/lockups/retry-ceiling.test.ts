import { describe, expect, test } from "vitest";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";

const throttledForever = {
  onCall: 0,
  status: 429,
  code: "activityLimitReached",
  retryAfter: "1",
} as const;

const throttleEveryCall = (harness: ReturnType<typeof createHarness>): void => {
  for (let call = 1; call <= 12; call += 1) {
    harness.fake.failListOn({ ...throttledForever, onCall: call });
  }
};

describe("a permanently throttled request stops at its budget", () => {
  test("MS-L5: a permanently throttled request stops at the budget and makes exactly maxAttempts transport calls", async () => {
    const harness = createHarness();
    throttleEveryCall(harness);

    const answered = await harness.provider.listChanges(
      { scope: scopeOver(marchWindow), resume: null },
      operationContext(harness.environment, {
        maxAttempts: 3,
        retryDelayCeilingMs: 1,
        deadlineMs: 5000,
      }),
    );

    expect(answered.ok).toBe(false);
    expect(harness.fake.listCallCount()).toBe(3);
  }, 30_000);

  test("MS-L5: the ceiling that stopped it is the budget it was handed", async () => {
    const three = createHarness();
    throttleEveryCall(three);
    const five = createHarness();
    throttleEveryCall(five);

    await three.provider.listChanges(
      { scope: scopeOver(marchWindow), resume: null },
      operationContext(three.environment, {
        maxAttempts: 3,
        retryDelayCeilingMs: 1,
        deadlineMs: 5000,
      }),
    );
    await five.provider.listChanges(
      { scope: scopeOver(marchWindow), resume: null },
      operationContext(five.environment, {
        maxAttempts: 5,
        retryDelayCeilingMs: 1,
        deadlineMs: 5000,
      }),
    );

    expect(three.fake.listCallCount()).toBe(3);
    expect(five.fake.listCallCount()).toBe(5);
  }, 30_000);

  test("MS-L5: nothing is left armed once the budget is spent", async () => {
    const harness = createHarness();
    throttleEveryCall(harness);

    await harness.provider.listChanges(
      { scope: scopeOver(marchWindow), resume: null },
      operationContext(harness.environment, {
        maxAttempts: 3,
        retryDelayCeilingMs: 1,
        deadlineMs: 5000,
      }),
    );

    expect(harness.environment.clock.pendingTimers()).toBe(0);
  }, 30_000);
});
