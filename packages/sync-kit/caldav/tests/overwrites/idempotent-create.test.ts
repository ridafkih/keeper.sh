import { describe, expect, test } from "vitest";
import { outcomeKindOf } from "../support/expect";
import { createHarness, operationContext } from "../support/harness";
import { createIntent, normalizedOf, timedContent } from "../support/intents";

describe("a replayed create is not a second event", () => {
  test("DAV-O36: a replayed create is alreadyExists, never a second resource", async () => {
    const harness = createHarness();
    const context = operationContext(harness.environment, { deadlineMs: 2000 });
    const intent = createIntent("idem-one", normalizedOf(timedContent()), "caldav-tests");

    const first = await harness.provider.write(intent, context);
    const replayed = await harness.provider.write(intent, context);

    expect(outcomeKindOf(first)).toBe("created");
    expect(outcomeKindOf(replayed)).toBe("alreadyExists");
    expect(harness.fake.resources().length).toBe(1);
  }, 30_000);

  test("DAV-O36: the second attempt sends If-None-Match and never a bare PUT", async () => {
    const harness = createHarness();
    const context = operationContext(harness.environment, { deadlineMs: 2000 });
    const intent = createIntent("idem-one", normalizedOf(timedContent()), "caldav-tests");

    await harness.provider.write(intent, context);
    await harness.provider.write(intent, context);

    const conditions = harness.fake.requestsOf("PUT").map((entry) => entry.headers["if-none-match"]);
    expect(conditions).toEqual(["*", "*"]);
  }, 30_000);
});
