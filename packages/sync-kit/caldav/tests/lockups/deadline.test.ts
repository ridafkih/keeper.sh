import { describe, expect, test } from "vitest";
import { raceDeadline } from "../../src/client/deadline";
import { failureKindOf } from "../support/expect";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";

describe("an await on a CalDAV server that never answers still ends", () => {
  test("DAV-L5: a fetch stub that never resolves makes listChanges reject at the deadline, not hang", async () => {
    const harness = createHarness({ fake: { stalls: true } });

    const listed = await harness.provider.listChanges(
      { scope: scopeOver(decadeWindow), resume: null },
      operationContext(harness.environment, { deadlineMs: 20 }),
    );

    expect(failureKindOf(listed)).toBe("notAttempted");
    expect(harness.environment.clock.pendingTimers()).toBe(0);
  }, 30_000);

  test("DAV-L5: a deadline already spent is refused before the request is made", async () => {
    const harness = createHarness();
    let calls = 0;

    const raced = await raceDeadline(
      operationContext(harness.environment, { deadlineMs: -1 }),
      harness.environment.clock,
      () => {
        calls += 1;
        return Promise.resolve("answered");
      },
    );

    expect(raced).toEqual({ kind: "notAttempted", reason: "budgetExhausted" });
    expect(calls).toBe(0);
  }, 30_000);
});
