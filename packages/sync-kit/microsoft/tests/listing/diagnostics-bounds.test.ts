import { describe, expect, test } from "vitest";
import { microsoftLimits } from "../../src/limits";
import { listingOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { seedOf, timedItem } from "../support/items";

const fiveHundredUnbuildableEvents = () => {
  const items = [];
  for (let index = 0; index < 500; index += 1) {
    items.push(
      timedItem({
        id: `id-broken-${index}`,
        uid: `broken-${index}`,
        start: "2026-03-14T09:00:00.0000000",
        end: "2026-03-14T10:00:00.0000000",
        originalStartTimeZone: "Nonsense Standard Time",
        timeZone: "Nonsense Standard Time",
      }),
    );
  }
  return items;
};

describe("diagnostics are a capped sample beside an exact total", () => {
  test("MS-O40: samples are capped beside an exact total", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf([]));
    harness.fake.putItems(fiveHundredUnbuildableEvents());

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment, { deadlineMs: 5000 }),
      ),
    );

    expect(listing.diagnostics.withheld.total).toBe(500);
    expect(listing.diagnostics.withheld.sample).toHaveLength(
      microsoftLimits.diagnosticSampleEntries,
    );
  }, 30_000);
});
