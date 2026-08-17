import { assertNoRemovalDerivable } from "@keeper.sh/sync-conformance";
import { describe, expect, test } from "vitest";
import { listingOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { manyForeignEvents, seedOf } from "../support/items";

const goneOnFirstCall = { onCall: 1, status: 410, code: "resyncRequired" } as const;

describe("an invalidated delta token deletes nothing", () => {
  test("MS-O1: a 410 resyncRequired yields cursorLost, zero removals and no cursor", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(manyForeignEvents(3)));
    harness.fake.failListOn(goneOnFirstCall);

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment),
      ),
    );

    expect(listing.kind).toBe("cursorLost");
    expect(listing.removals).toBeUndefined();
    expect(listing.cursor).toBeUndefined();
    assertNoRemovalDerivable(listing);
  });

  test("MS-O1: a syncStateNotFound 410 lands on the same arm as resyncRequired", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(manyForeignEvents(3)));
    harness.fake.failListOn({ onCall: 1, status: 410, code: "syncStateNotFound" });

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment),
      ),
    );

    expect(listing.kind).toBe("cursorLost");
    expect(listing.events).toBeUndefined();
  });
});
