import { describe, expect, test } from "vitest";
import { createHarness, marchWindow, operationContext, scopeOver, suiteStart } from "../support/harness";

const throttledForever = {
  kind: "status",
  status: 429,
  retryAfter: { kind: "instant", value: "2099-01-01T00:00:00.000Z" },
  times: Number.MAX_SAFE_INTEGER,
} as const;

const elapsedFakeMs = (nowValue: string): number =>
  Date.parse(nowValue) - Date.parse(suiteStart.value);

describe("retry has a ceiling that a hostile provider cannot raise", () => {
  test("GOOG-L1: an operation given three attempts reaches the transport three times", async () => {
    const harness = createHarness();
    harness.environment.transport.answerWith(throttledForever);

    const answered = await harness.provider.listChanges(
      { scope: scopeOver(marchWindow), resume: null },
      operationContext(harness.environment, {
        maxAttempts: 3,
        retryDelayCeilingMs: 10,
        deadlineMs: 5000,
      }),
    );

    expect(answered.ok).toBe(false);
    expect(harness.environment.transport.callCount()).toBe(3);
  });

  test("GOOG-L1: a Retry-After in the next century cannot outlast the delay ceiling", async () => {
    const harness = createHarness();
    harness.environment.transport.answerWith(throttledForever);

    await harness.provider.listChanges(
      { scope: scopeOver(marchWindow), resume: null },
      operationContext(harness.environment, {
        maxAttempts: 3,
        retryDelayCeilingMs: 10,
        deadlineMs: 5000,
      }),
    );

    expect(elapsedFakeMs(harness.environment.clock.now().value)).toBeLessThanOrEqual(30);
  });

  test("GOOG-L1: the ceiling that stopped it is the budget it was handed, not an incidental one", async () => {
    const three = createHarness();
    three.environment.transport.answerWith(throttledForever);
    const five = createHarness();
    five.environment.transport.answerWith(throttledForever);

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

    expect(three.environment.transport.callCount()).toBe(3);
    expect(five.environment.transport.callCount()).toBe(5);
  });

  test("GOOG-L1: nothing is left armed once the budget is spent", async () => {
    const harness = createHarness();
    harness.environment.transport.answerWith(throttledForever);

    await harness.provider.listChanges(
      { scope: scopeOver(marchWindow), resume: null },
      operationContext(harness.environment, {
        maxAttempts: 3,
        retryDelayCeilingMs: 1,
        deadlineMs: 5000,
      }),
    );

    expect(harness.environment.clock.pendingTimers()).toBe(0);
  });
});
