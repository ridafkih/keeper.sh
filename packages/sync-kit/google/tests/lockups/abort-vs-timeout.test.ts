import { describe, expect, test } from "vitest";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";

describe("a caller's cancel is not a provider timeout", () => {
  test("GOOG-L3: a caller abort is not reported as a provider timeout", async () => {
    const harness = createHarness();
    harness.environment.transport.stall();
    const caller = new AbortController();

    const inFlight = harness.provider.listChanges(
      { scope: scopeOver(marchWindow), resume: null },
      operationContext(harness.environment, { signal: caller.signal, deadlineMs: 5000 }),
    );
    await Promise.resolve();
    caller.abort();
    const answered = await inFlight;

    expect(harness.environment.transport.callCount()).toBeGreaterThan(0);
    if (answered.ok) {
      throw new Error("an aborted listing answered a value");
    }
    expect(answered.failure).toEqual({ kind: "notAttempted", reason: "aborted" });
  }, 30_000);

  test("GOOG-L3: an abort mid-flight leaves no timer armed", async () => {
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

  test("GOOG-L3: a signal already aborted spends no request proving it", async () => {
    const harness = createHarness();
    const caller = new AbortController();
    caller.abort();

    const answered = await harness.provider.listChanges(
      { scope: scopeOver(marchWindow), resume: null },
      operationContext(harness.environment, { signal: caller.signal }),
    );

    expect(harness.environment.transport.callCount()).toBe(0);
    if (answered.ok) {
      throw new Error("an already-aborted listing answered a value");
    }
    expect(answered.failure).toEqual({ kind: "notAttempted", reason: "aborted" });
  });
});
