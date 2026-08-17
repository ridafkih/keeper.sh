import { describe, expect, test } from "vitest";
import { outcomeKindOf, outcomeOf } from "../support/expect";
import { createHarness, operationContext } from "../support/harness";
import { createIntent, normalizedOf, timedContent } from "../support/intents";

describe("a PUT echoes nothing, and that is stated rather than assumed", () => {
  test("DAV-O41: a 204 with no body reports notObserved and never matched", async () => {
    const harness = createHarness();

    const created = await harness.provider.write(
      createIntent("idem-one", normalizedOf(timedContent()), "caldav-tests"),
      operationContext(harness.environment, { deadlineMs: 2000 }),
    );

    const outcome = outcomeOf(created);
    expect(outcomeKindOf(created)).toBe("created");
    if (outcome.kind !== "created") {
      throw new Error(`a create answered "${outcome.kind}"`);
    }
    expect(outcome.echo).toEqual({ kind: "notObserved" });
  }, 30_000);
});
