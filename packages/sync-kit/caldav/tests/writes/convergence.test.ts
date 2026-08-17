import { describe, expect, test } from "vitest";
import { outcomeKindOf } from "../support/expect";
import { createHarness, operationContext } from "../support/harness";
import { createIntent, normalizedOf, timedContent } from "../support/intents";

describe("replaying a write plan is not a rewrite", () => {
  test("DAV-O64: replaying the same write plan produces no second operation", async () => {
    const harness = createHarness();
    const context = operationContext(harness.environment, { deadlineMs: 2000 });
    const plan = [
      createIntent("idem-one", normalizedOf(timedContent({ title: "One" })), "caldav-tests"),
      createIntent("idem-two", normalizedOf(timedContent({ title: "Two" })), "caldav-tests"),
    ];

    const first = await Promise.all(plan.map((intent) => harness.provider.write(intent, context)));
    const writesAfterFirst = harness.fake.requestsOf("PUT").length;
    const replayed = await Promise.all(
      plan.map((intent) => harness.provider.write(intent, context)),
    );

    expect(first.map((entry) => outcomeKindOf(entry))).toEqual(["created", "created"]);
    expect(replayed.map((entry) => outcomeKindOf(entry))).toEqual([
      "alreadyExists",
      "alreadyExists",
    ]);
    expect(harness.fake.resources().length).toBe(2);
    expect(writesAfterFirst).toBe(2);
  }, 30_000);
});
