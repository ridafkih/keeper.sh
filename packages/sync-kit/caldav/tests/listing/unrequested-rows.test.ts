import { describe, expect, test } from "vitest";
import { listingOf } from "../support/expect";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";
import { manyResources } from "../support/resources";

describe("rows nobody asked for are counted, not fatal", () => {
  test("DAV-O20: an unrequested row does not fail the listing", async () => {
    const harness = createHarness({
      fake: { returnsUnrequestedRows: true, announcesSyncCollection: false },
      resources: manyResources(3),
    });

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(decadeWindow), resume: null },
        operationContext(harness.environment, { deadlineMs: 2000 }),
      ),
    );

    expect(listing.kind).toBe("snapshot");
    expect((listing.events ?? []).length).toBe(3);
  }, 30_000);

  test("DAV-H9: coverage accounting is populated on the incomplete arm too", async () => {
    const harness = createHarness({
      fake: { returnsUnrequestedRows: true, capsMultigetAt: 2, announcesSyncCollection: false },
      resources: manyResources(3),
    });

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(decadeWindow), resume: null },
        operationContext(harness.environment, { deadlineMs: 2000 }),
      ),
    );

    expect(listing.kind).toBe("partial");
    expect(listing.diagnostics.pagesFetched).toBeGreaterThan(0);
  }, 30_000);
});
