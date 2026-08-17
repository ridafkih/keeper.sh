import { describe, expect, test } from "vitest";
import { listingOf } from "../support/expect";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";
import { singleEventResource } from "../support/resources";

describe("sync-collection is probed, never assumed", () => {
  test("DAV-O14: a collection without sync-collection never returns a cursor", async () => {
    const harness = createHarness({
      fake: { announcesSyncCollection: false },
      resources: [singleEventResource("one.ics", { uid: "one@example.com" })],
    });

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(decadeWindow), resume: null },
        operationContext(harness.environment, { deadlineMs: 2000 }),
      ),
    );

    expect(listing.kind).toBe("snapshot");
    expect(listing.cursor).toBeNull();
    expect(harness.fake.reportsOf("sync-collection")).toEqual([]);
  }, 30_000);

  test("DAV-H5: the probe is issued once per collection per run", async () => {
    const harness = createHarness({
      resources: [singleEventResource("one.ics", { uid: "one@example.com" })],
    });
    const scope = scopeOver(decadeWindow);
    const context = operationContext(harness.environment, { deadlineMs: 2000 });

    await harness.provider.listChanges({ scope, resume: null }, context);
    await harness.provider.listChanges({ scope, resume: null }, context);

    const probes = harness.fake
      .requestsOf("PROPFIND")
      .filter((entry) => entry.body.includes("supported-report-set"));
    expect(probes.length).toBe(1);
  }, 30_000);
});
