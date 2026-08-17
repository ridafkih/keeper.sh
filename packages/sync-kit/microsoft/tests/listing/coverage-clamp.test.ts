import { assertCoverageProven } from "@keeper.sh/sync-conformance";
import { describe, expect, test } from "vitest";
import { listingOf } from "../support/expect";
import {
  createHarness,
  decadeWindow,
  marchWindow,
  operationContext,
  scopeOver,
} from "../support/harness";
import { manyForeignEvents, seedOf } from "../support/items";

describe("coverage is earned by the walk, never claimed from the request", () => {
  test("MS-O12: proven coverage is the walked window, never the requested one", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(manyForeignEvents(3)));

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment),
      ),
    );

    expect(listing.coverage?.covered.start.value).toBe(marchWindow.start.value);
    expect(listing.coverage?.covered.end.value).toBe(marchWindow.end.value);
    expect(listing.coverage?.covered.end.value).not.toBe(decadeWindow.end.value);
    assertCoverageProven(listing, scopeOver(marchWindow));
  });

  test("MS-O12: a truncated walk carries no coverage claim at all", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(manyForeignEvents(40)));
    harness.fake.pageEvery(1);
    harness.fake.cyclesNextLink();

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(decadeWindow), resume: null },
        operationContext(harness.environment, { deadlineMs: 5000 }),
      ),
    );

    expect(listing.coverage).toBeUndefined();
  }, 30_000);
});
