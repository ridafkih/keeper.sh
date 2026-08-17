import { describe, expect, test } from "vitest";
import { raceDeadline } from "../../src/client/deadline";
import { failureKindOf } from "../support/expect";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";
import { countingSignal } from "../support/signals";

const HANG_TIMEOUT = 30_000;

describe("a cancel and a timeout are different answers", () => {
  test("DAV-L7: a caller abort mid-flight rejects as aborted and removes its listeners", async () => {
    const harness = createHarness({ fake: { stalls: true } });
    const caller = countingSignal();
    const listing = harness.provider.listChanges(
      { scope: scopeOver(decadeWindow), resume: null },
      operationContext(harness.environment, { signal: caller.signal, deadlineMs: 5000 }),
    );
    caller.abort();
    const answered = await listing;

    if (answered.ok || answered.failure.kind !== "notAttempted") {
      throw new Error(`an aborted listing answered "${failureKindOf(answered)}"`);
    }
    expect(answered.failure.reason).toBe("aborted");
    expect(harness.environment.clock.pendingTimers()).toBe(0);
    expect(caller.attached()).toBe(0);
  }, HANG_TIMEOUT);

  test("DAV-L7: a timeout is budgetExhausted, never aborted", async () => {
    const harness = createHarness();

    const raced = await raceDeadline(
      operationContext(harness.environment, { deadlineMs: 20 }),
      harness.environment.clock,
      () => Promise.withResolvers<string>().promise,
    );

    expect(raced).toEqual({ kind: "notAttempted", reason: "budgetExhausted" });
    expect(harness.environment.clock.pendingTimers()).toBe(0);
  }, HANG_TIMEOUT);
});
