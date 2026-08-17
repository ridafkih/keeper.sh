import { assertNoRemovalDerivable } from "@keeper.sh/sync-conformance";
import { describe, expect, test } from "vitest";
import { listingOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { manyForeignEvents, seedOf } from "../support/items";

describe("a truncated read never claims to be a complete one", () => {
  test("MS-O4: a page ceiling stop yields a continuation and no cursor", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(manyForeignEvents(60)));
    harness.fake.pageEvery(1);
    harness.fake.cyclesNextLink();

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment, { deadlineMs: 5000 }),
      ),
    );

    expect(listing.kind).toBe("partial");
    expect(listing.cursor).toBeUndefined();
    expect(listing.continuation?.kind).toBe("continuation");
    assertNoRemovalDerivable(listing);
  }, 30_000);

  test("MS-O4: a truncated read reports the pages it actually walked", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(manyForeignEvents(60)));
    harness.fake.pageEvery(1);
    harness.fake.cyclesNextLink();

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment, { deadlineMs: 5000 }),
      ),
    );

    expect(listing.diagnostics.pagesFetched).toBeGreaterThan(0);
    expect(listing.coverage).toBeUndefined();
  }, 30_000);
});
