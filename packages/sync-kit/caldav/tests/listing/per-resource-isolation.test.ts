import { describe, expect, test } from "vitest";
import { listingOf } from "../support/expect";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";
import { manyResources, unparseableResource } from "../support/resources";

const HANG_TIMEOUT = 30_000;

describe("one bad resource does not take the collection with it", () => {
  test("DAV-O58: one malformed resource in fifty leaves the other forty-nine listed", async () => {
    const harness = createHarness({
      resources: [...manyResources(49), unparseableResource("broken.ics")],
    });

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(decadeWindow), resume: null },
        operationContext(harness.environment, { deadlineMs: 5000 }),
      ),
    );

    expect((listing.events ?? []).length).toBe(49);
    expect((listing.withheld ?? []).length).toBe(1);
    expect(listing.diagnostics.withheld.total).toBe(1);
  }, HANG_TIMEOUT);
});
