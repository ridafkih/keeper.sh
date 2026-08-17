import { describe, expect, test } from "vitest";
import { listingOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { seedOf, timedItem } from "../support/items";

const fourGoodEvents = [0, 1, 2, 3].map((index) =>
  timedItem({
    id: `id-good-${index}`,
    uid: `good-${index}`,
    start: `2026-03-1${index}T09:00:00.0000000`,
    end: `2026-03-1${index}T10:00:00.0000000`,
  }),
);

describe("one bad event does not cost the calendar", () => {
  test("MS-O15: one undecodable event does not cost the other events in the same page", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf([]));
    harness.fake.putItems(fourGoodEvents);
    harness.fake.putRaw([{ id: "id-malformed", start: "not-a-time", end: null }]);

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment),
      ),
    );

    expect(listing.events).toHaveLength(4);
    expect(listing.withheld).toHaveLength(1);
  });

  test("MS-O15: a page of nothing but malformed items still answers, and withholds each one", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf([]));
    harness.fake.putRaw([{ id: "one" }, { id: "two" }, {}]);

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment),
      ),
    );

    expect(listing.events).toEqual([]);
    expect(listing.diagnostics.withheld.total).toBe(3);
  });
});
