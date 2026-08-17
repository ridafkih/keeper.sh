import { assertNoRemovalDerivable, assertNotSnapshotUnderTruncation } from "@keeper.sh/sync-conformance";
import { describe, expect, test } from "vitest";
import { listingOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { hundredForeignEvents, seedOf } from "../support/items";

describe("a truncated read claims no coverage", () => {
  test("GOOG-O4: a page ceiling stop yields a continuation and no cursor", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(hundredForeignEvents()));
    harness.fake.neverStopPaging();

    const answered = await harness.provider.listChanges(
      { scope: scopeOver(marchWindow), resume: null },
      operationContext(harness.environment),
    );
    const listing = listingOf(answered);

    expect(listing.kind).toBe("partial");
    expect(listing.cursor).toBeUndefined();
    expect(listing.continuation).toBeDefined();
    assertNotSnapshotUnderTruncation(answered);
    assertNoRemovalDerivable(listing);
  });

  test("GOOG-O4: a truncated read still reports the events it did observe", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(hundredForeignEvents()));
    harness.fake.neverStopPaging();

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment),
      ),
    );

    expect(listing.events?.length).toBeGreaterThan(0);
    expect(listing.coverage).toBeUndefined();
  });
});
