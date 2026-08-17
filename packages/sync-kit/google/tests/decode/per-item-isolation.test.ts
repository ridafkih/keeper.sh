import { describe, expect, test } from "vitest";
import { listingOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { timedItem } from "../support/items";

const fiveItemsOneOfWhichNamesNoInstant = () => [
  timedItem({ id: "good-1", start: "2026-03-12T09:00:00.000Z", end: "2026-03-12T10:00:00.000Z" }),
  timedItem({ id: "good-2", start: "2026-03-13T09:00:00.000Z", end: "2026-03-13T10:00:00.000Z" }),
  {
    id: "zone-only",
    iCalUID: "zone-only@google.com",
    etag: '"v1-zone-only"',
    status: "confirmed",
    summary: "no instant at all",
    updated: "2026-03-11T00:00:00.000Z",
    eventType: "default",
    start: { timeZone: "UTC" },
    end: { timeZone: "UTC" },
  },
  timedItem({ id: "good-3", start: "2026-03-14T09:00:00.000Z", end: "2026-03-14T10:00:00.000Z" }),
  timedItem({ id: "good-4", start: "2026-03-15T09:00:00.000Z", end: "2026-03-15T10:00:00.000Z" }),
];

describe("one bad item costs one item", () => {
  test("GOOG-O22: a start with a zone and no instant is withheld and the page still lists", async () => {
    const harness = createHarness();
    harness.fake.putItems(fiveItemsOneOfWhichNamesNoInstant());

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment),
      ),
    );

    expect(listing.events).toHaveLength(4);
    expect(listing.withheld).toHaveLength(1);
    expect(listing.withheld?.at(0)?.reason).toBe("unrepresentableTime");
  });

  test("GOOG-O22: the withheld item is present in the listing, never absent from it", async () => {
    const harness = createHarness();
    harness.fake.putItems(fiveItemsOneOfWhichNamesNoInstant());

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment),
      ),
    );

    expect(listing.removals).toEqual([]);
    expect(listing.withheld?.at(0)?.id?.value).toBe("zone-only");
  });
});
