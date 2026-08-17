import { describe, expect, test } from "vitest";
import { listingOf } from "../support/expect";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";
import { deleteIntent, retireIntent } from "../support/intents";
import { singleEventResource } from "../support/resources";

describe("the precondition has to survive tsdav's cleanupFalsy and reach the wire", () => {
  test("DAV-O40: every DELETE this adapter issues carries an If-Match header", async () => {
    const harness = createHarness({
      fake: { honoursIfMatch: false },
      resources: [
        singleEventResource("one.ics", { uid: "one@example.com" }),
        singleEventResource("two.ics", { uid: "two@example.com" }),
      ],
    });
    const context = operationContext(harness.environment, { deadlineMs: 2000 });
    const listed = listingOf(
      await harness.provider.listChanges({ scope: scopeOver(decadeWindow), resume: null }, context),
    );
    const [first, second] = listed.events ?? [];
    if (!first || !second) {
      throw new Error("the listing described fewer than two events to remove");
    }

    await harness.provider.write(deleteIntent(first.deleteHandle.value, first.version), context);
    await harness.provider.write(retireIntent(second.deleteHandle.value, second.version), context);

    const headers = harness.fake.requestsOf("DELETE").map((entry) => entry.headers["if-match"]);
    expect(headers.length).toBe(2);
    expect(headers.filter((value) => typeof value === "string" && value.length > 0).length).toBe(2);
  }, 30_000);
});
