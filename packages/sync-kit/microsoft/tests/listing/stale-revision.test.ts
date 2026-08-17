import { describe, expect, test } from "vitest";
import { listingOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { seedOf, timedItem } from "../support/items";

const buildableOlder = timedItem({
  id: "id-superseded",
  uid: "superseded",
  start: "2026-03-14T09:00:00.0000000",
  end: "2026-03-14T10:00:00.0000000",
  lastModified: "2026-03-11T09:00:00.000Z",
});

const unbuildableNewer = timedItem({
  id: "id-superseded",
  uid: "superseded",
  start: "2026-03-14T15:00:00.0000000",
  end: "2026-03-14T16:00:00.0000000",
  lastModified: "2026-03-11T10:00:00.000Z",
  originalStartTimeZone: "Nonsense Standard Time",
  timeZone: "Nonsense Standard Time",
});

describe("a newer revision we cannot build never falls back to the older one", () => {
  test("MS-O21: an unbuildable newest revision withholds the identity instead of falling back", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf([]));
    harness.fake.putItems([buildableOlder, unbuildableNewer]);
    harness.fake.pageEvery(1);

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment, { deadlineMs: 5000 }),
      ),
    );

    expect(listing.events).toEqual([]);
    expect(listing.withheld?.map((entry) => entry.reason)).toEqual([
      "supersededRevisionUnbuildable",
    ]);
  }, 30_000);
});
