import { describe, expect, test } from "vitest";
import { raceDeadline } from "../../src/client/deadline";
import { createHarness, operationContext } from "../support/harness";

const HANG_TIMEOUT = 30_000;

describe("a caller that stops waiting also stops the work", () => {
  test("DAV-L7: the signal handed to the work is aborted when the budget expires", async () => {
    const harness = createHarness();
    const context = operationContext(harness.environment, { deadlineMs: 50 });
    const observed = Promise.withResolvers<string>();

    const raced = raceDeadline(context, harness.environment.clock, (signal) => {
      signal.addEventListener("abort", () => {
        observed.resolve("cancelled");
      });
      return Promise.withResolvers<string>().promise;
    });
    await harness.environment.clock.advance(60);

    expect(await raced).toEqual({ kind: "notAttempted", reason: "budgetExhausted" });
    expect(await observed.promise).toBe("cancelled");
  }, HANG_TIMEOUT);

  test("DAV-L7: a genuine rejection is carried out rather than relabelled as an exhausted budget", async () => {
    const harness = createHarness();
    const context = operationContext(harness.environment, { deadlineMs: 5000 });

    const raced = raceDeadline(context, harness.environment.clock, () =>
      Promise.reject(new TypeError("the socket closed")),
    );

    await expect(raced).rejects.toThrow("the socket closed");
  }, HANG_TIMEOUT);
});
