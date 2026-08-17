import { describe, expect, test } from "vitest";
import { microsoftPrefer } from "../../src/client/prefer";
import { microsoftLimits } from "../../src/limits";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { manyForeignEvents, seedOf } from "../support/items";

describe("every listing request carries the Prefer set the adapter declares", () => {
  test("MS-H3: every listing request carries the declared Prefer set", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(manyForeignEvents(3)));

    await harness.provider.listChanges(
      { scope: scopeOver(marchWindow), resume: null },
      operationContext(harness.environment, { deadlineMs: 5000 }),
    );

    const listRequests = harness.fake
      .requests()
      .filter((request) => request.path.includes("/calendarView"));
    const missing = listRequests.filter((request) =>
      microsoftPrefer.some((directive) => !(request.prefer ?? "").includes(directive)),
    );
    expect(listRequests.length).toBeGreaterThan(0);
    expect(missing).toEqual([]);
    expect(microsoftPrefer).toContain(`odata.maxpagesize=${microsoftLimits.pageSize}`);
  }, 30_000);
});
