import { describe, expect, test } from "vitest";
import { outcomeOf } from "../support/expect";
import { createHarness, operationContext } from "../support/harness";
import { createIntent, normalizedOf, recurringContent } from "../support/intents";

describe("a series and its overrides are one calendar object resource", () => {
  test("DAV-O46: a master and three overrides are one PUT", async () => {
    const harness = createHarness();
    const series = recurringContent("FREQ=WEEKLY;COUNT=8", [
      "20260309T090000Z",
      "20260316T090000Z",
      "20260323T090000Z",
    ]);

    const created = await harness.provider.write(
      createIntent("idem-series", normalizedOf(series), "caldav-tests"),
      operationContext(harness.environment, { deadlineMs: 2000 }),
    );

    expect(outcomeOf(created).kind).toBe("created");
    expect(harness.fake.requestsOf("PUT").length).toBe(1);
    expect(harness.fake.resources().length).toBe(1);
    const [stored] = harness.fake.resources();
    expect([...(stored?.data ?? "").matchAll(/UID:/g)].length).toBe(1);
  }, 30_000);
});
