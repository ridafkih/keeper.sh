import { describe, expect, test } from "vitest";
import { failureKindOf, listingOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { occurrenceItem, seedOf, seriesMasterItem } from "../support/items";

const expandingScope = () => ({
  ...scopeOver(marchWindow),
  expandRecurrences: true,
});

describe("an empty expansion and an errored expansion are different answers", () => {
  test("MS-O19: an empty expansion is counted and an errored expansion fails the listing", async () => {
    const empty = createHarness();
    empty.fake.seedFromProvider(seedOf([]));
    empty.fake.putItems([seriesMasterItem("master-empty", "2026-03-16T09:00:00.0000000")]);
    empty.fake.putInstances("master-empty", []);

    const listing = listingOf(
      await empty.provider.listChanges(
        { scope: expandingScope(), resume: null },
        operationContext(empty.environment, { deadlineMs: 5000 }),
      ),
    );

    const errored = createHarness();
    errored.fake.seedFromProvider(seedOf([]));
    errored.fake.putItems([seriesMasterItem("master-broken", "2026-03-16T09:00:00.0000000")]);
    errored.fake.failInstancesFor("master-broken");

    const answered = await errored.provider.listChanges(
      { scope: expandingScope(), resume: null },
      operationContext(errored.environment, { deadlineMs: 5000 }),
    );

    expect(listing.events).toEqual([]);
    expect(listing.diagnostics.unrepresentable.total).toBe(0);
    expect(answered.ok).toBe(false);
    expect(failureKindOf(answered)).toBe("transport");
  }, 30_000);

  test("MS-O19: an expansion that answers instances contributes them as events", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf([]));
    harness.fake.putItems([seriesMasterItem("master-full", "2026-03-16T09:00:00.0000000")]);
    harness.fake.putInstances("master-full", [
      occurrenceItem(
        "occurrence-one",
        "master-full",
        "2026-03-16T09:00:00.0000000",
        "2026-03-16T10:00:00.0000000",
      ),
    ]);

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: expandingScope(), resume: null },
        operationContext(harness.environment, { deadlineMs: 5000 }),
      ),
    );

    expect(listing.events?.map((event) => event.id.value)).toEqual(["occurrence-one"]);
  }, 30_000);
});
