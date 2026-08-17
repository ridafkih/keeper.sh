import { describe, expect, test } from "vitest";
import type { ChangeListing, Result } from "@keeper.sh/sync-protocol";
import { failureKindOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";

const notAttemptedReasonOf = (answered: Result<ChangeListing>): string => {
  if (answered.ok || answered.failure.kind !== "notAttempted") {
    return "attempted";
  }
  return answered.failure.reason;
};

describe("a caller's cancel is not a provider timeout", () => {
  test("MS-L8: an aborted request is aborted and a timed out request is budgetExhausted", async () => {
    const aborted = createHarness();
    aborted.environment.transport.stall();
    const caller = new AbortController();
    const inFlight = aborted.provider.listChanges(
      { scope: scopeOver(marchWindow), resume: null },
      operationContext(aborted.environment, { signal: caller.signal, deadlineMs: 5000 }),
    );
    await Promise.resolve();
    caller.abort();
    const cancelled = await inFlight;

    const timedOut = createHarness();
    timedOut.environment.transport.stall();
    const expired = await timedOut.provider.listChanges(
      { scope: scopeOver(marchWindow), resume: null },
      operationContext(timedOut.environment, { deadlineMs: 20 }),
    );

    expect(cancelled.ok).toBe(false);
    expect(failureKindOf(cancelled)).toBe("notAttempted");
    expect(notAttemptedReasonOf(cancelled)).toBe("aborted");
    expect(notAttemptedReasonOf(expired)).toBe("budgetExhausted");
  }, 30_000);

  test("MS-L8: an abort mid-flight leaves no timer armed", async () => {
    const harness = createHarness();
    harness.environment.transport.stall();
    const caller = new AbortController();

    const inFlight = harness.provider.listChanges(
      { scope: scopeOver(marchWindow), resume: null },
      operationContext(harness.environment, { signal: caller.signal, deadlineMs: 5000 }),
    );
    await Promise.resolve();
    caller.abort();
    await inFlight;

    expect(harness.environment.clock.pendingTimers()).toBe(0);
  }, 30_000);
});
