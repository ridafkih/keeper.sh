import { describe, expect, test } from "vitest";
import { raceDeadline } from "../../src/client/deadline";
import { createHarness, operationContext } from "../support/harness";

describe("an await on Graph that never answers still ends", () => {
  test("MS-L7: a request that never resolves rejects at the deadline", async () => {
    const harness = createHarness();

    const raced = await raceDeadline(
      operationContext(harness.environment, { deadlineMs: 20 }),
      harness.environment.clock,
      () => Promise.withResolvers<string>().promise,
    );

    expect(raced).toEqual({ kind: "notAttempted", reason: "budgetExhausted" });
    expect(harness.environment.clock.pendingTimers()).toBe(0);
  }, 30_000);

  test("MS-L7: a deadline already spent is refused before the call is made", async () => {
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
