import { describe, expect, test } from "vitest";
import { outcomeOf } from "../support/expect";
import { createHarness, operationContext } from "../support/harness";
import { createIntent, normalizedOf, timedContent } from "../support/intents";

describe("a server that omits the ETag on a PUT is asked, not guessed at", () => {
  test("DAV-O42: a PUT without an ETag header re-reads for the version instead of inventing one", async () => {
    const harness = createHarness({ fake: { omitsEtagOnPut: true } });

    const created = await harness.provider.write(
      createIntent("idem-one", normalizedOf(timedContent()), "caldav-tests"),
      operationContext(harness.environment, { deadlineMs: 2000 }),
    );

    const outcome = outcomeOf(created);
    if (outcome.kind !== "created") {
      throw new Error(`a create answered "${outcome.kind}"`);
    }
    expect(outcome.version.value.length).toBeGreaterThan(0);
    expect(harness.fake.requestsOf("PROPFIND").length).toBeGreaterThan(0);
  }, 30_000);
});
