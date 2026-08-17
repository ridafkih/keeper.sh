import { describe, expect, test } from "vitest";
import { failureKindOf } from "../support/expect";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";
import { singleEventResource } from "../support/resources";

describe("the injected fetch is the only transport", () => {
  test("DAV-O55: every request reaches the injected fetch exactly once per attempt", async () => {
    const harness = createHarness({ resources: [singleEventResource("one.ics")] });

    const listed = await harness.provider.listChanges(
      { scope: scopeOver(decadeWindow), resume: null },
      operationContext(harness.environment, { deadlineMs: 2000 }),
    );

    expect(failureKindOf(listed)).toBe("ok");
    const bodies = harness.fake
      .requests()
      .map((entry) => `${entry.method} ${entry.path} ${entry.body}`);
    expect(bodies.length).toBeGreaterThan(0);
    expect(new Set(bodies).size).toBe(bodies.length);
  }, 30_000);
});
