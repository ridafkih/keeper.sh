import { describe, expect, test } from "vitest";
import { caldavLimits } from "../../src/limits";
import { listingOf } from "../support/expect";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";
import { manyResources } from "../support/resources";

const HANG_TIMEOUT = 30_000;

describe("a large collection is read in bounded batches", () => {
  test("DAV-H4: a 1,000-href listing is requested in bounded batches and every href is accounted for", async () => {
    const total = 1000;
    const harness = createHarness({
      fake: { announcesSyncCollection: false },
      resources: manyResources(total),
    });

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(decadeWindow), resume: null },
        operationContext(harness.environment, { deadlineMs: 5000 }),
      ),
    );

    const batches = harness.fake.reportsOf("calendar-multiget");
    expect(batches.length).toBe(Math.ceil(total / caldavLimits.multigetBatchSize));
    expect((listing.events ?? []).length).toBe(total);
  }, HANG_TIMEOUT);

  test("DAV-H4: no single batch asks for more hrefs than the configured ceiling", async () => {
    const harness = createHarness({
      fake: { announcesSyncCollection: false },
      resources: manyResources(600),
    });

    await harness.provider.listChanges(
      { scope: scopeOver(decadeWindow), resume: null },
      operationContext(harness.environment, { deadlineMs: 5000 }),
    );

    const sizes = harness.fake
      .reportsOf("calendar-multiget")
      .map((entry) => [...entry.body.matchAll(/<[A-Za-z0-9]*:?href>/g)].length);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(caldavLimits.multigetBatchSize);
  }, HANG_TIMEOUT);
});
