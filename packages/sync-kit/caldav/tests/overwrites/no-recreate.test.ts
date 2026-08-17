import { describe, expect, test } from "vitest";
import { outcomeKindOf } from "../support/expect";
import { createHarness, operationContext } from "../support/harness";
import { createIntent, normalizedOf, timedContent } from "../support/intents";

describe("a create collision is never resolved by destroying the user's copy", () => {
  test("DAV-O37: a create collision with different content is a conflict and issues no DELETE", async () => {
    const harness = createHarness();
    const context = operationContext(harness.environment, { deadlineMs: 2000 });

    await harness.provider.write(
      createIntent("idem-one", normalizedOf(timedContent({ title: "Theirs" })), "caldav-tests"),
      context,
    );
    const colliding = await harness.provider.write(
      createIntent("idem-one", normalizedOf(timedContent({ title: "Ours" })), "caldav-tests"),
      context,
    );

    expect(outcomeKindOf(colliding)).toBe("conflict");
    expect(harness.fake.requestsOf("DELETE")).toEqual([]);
    expect(harness.fake.resources().length).toBe(1);
  }, 30_000);

  test("DAV-O37: the resource on the server still holds the copy that was there first", async () => {
    const harness = createHarness();
    const context = operationContext(harness.environment, { deadlineMs: 2000 });

    await harness.provider.write(
      createIntent("idem-one", normalizedOf(timedContent({ title: "Theirs" })), "caldav-tests"),
      context,
    );
    await harness.provider.write(
      createIntent("idem-one", normalizedOf(timedContent({ title: "Ours" })), "caldav-tests"),
      context,
    );

    const [stored] = harness.fake.resources();
    expect(stored?.data).toContain("Theirs");
    expect(stored?.data).not.toContain("Ours");
  }, 30_000);
});
