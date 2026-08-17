import { describe, expect, test } from "vitest";
import { failureKindOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";

describe("a request that never answers is bounded by its deadline", () => {
  test("GOOG-L2: a transport that never resolves settles at the deadline", async () => {
    const harness = createHarness();
    harness.environment.transport.stall();

    const answered = await harness.provider.listChanges(
      { scope: scopeOver(marchWindow), resume: null },
      operationContext(harness.environment, { deadlineMs: 25 }),
    );

    expect(harness.environment.transport.callCount()).toBeGreaterThan(0);
    expect(failureKindOf(answered)).toBe("notAttempted");
    expect(answered.ok).toBe(false);
  }, 30_000);

  test("GOOG-L2: the deadline is reported as budgetExhausted, never as a provider error", async () => {
    const harness = createHarness();
    harness.environment.transport.stall();

    const answered = await harness.provider.listChanges(
      { scope: scopeOver(marchWindow), resume: null },
      operationContext(harness.environment, { deadlineMs: 25 }),
    );

    if (answered.ok) {
      throw new Error("a stalled transport answered a listing");
    }
    expect(answered.failure).toEqual({ kind: "notAttempted", reason: "budgetExhausted" });
  }, 30_000);

  test("GOOG-L2: a deadline leaves no timer armed behind it", async () => {
    const harness = createHarness();
    harness.environment.transport.stall();

    await harness.provider.listChanges(
      { scope: scopeOver(marchWindow), resume: null },
      operationContext(harness.environment, { deadlineMs: 25 }),
    );

    expect(harness.environment.clock.pendingTimers()).toBe(0);
  }, 30_000);
});
