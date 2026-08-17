import { describe, expect, test } from "vitest";
import { listingOf } from "../support/expect";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";
import { singleEventResource } from "../support/resources";

describe("a BOM is stripped on every resource, not only the first", () => {
  test("DAV-O25: a BOM-prefixed resource is read, not skipped", async () => {
    const harness = createHarness({
      fake: { emitsBom: true },
      resources: [
        singleEventResource("one.ics", { uid: "one@example.com" }),
        singleEventResource("two.ics", { uid: "two@example.com" }),
      ],
    });

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(decadeWindow), resume: null },
        operationContext(harness.environment, { deadlineMs: 2000 }),
      ),
    );

    expect((listing.events ?? []).map((event) => event.uid.value).toSorted()).toEqual([
      "one@example.com",
      "two@example.com",
    ]);
    expect(listing.withheld).toEqual([]);
  }, 30_000);
});
