import { describe, expect, test } from "vitest";
import { listingOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { foreignEvent, seedOf } from "../support/items";

describe("a listing that ends without a nextSyncToken is cursor loss", () => {
  test("GOOG-O3: a final page with no nextSyncToken is cursorLost, not a delta", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(
      seedOf([
        foreignEvent({
          uid: "quiet",
          start: "2026-03-05T09:00:00.000Z",
          end: "2026-03-05T10:00:00.000Z",
        }),
      ]),
    );
    harness.fake.withholdSyncToken();

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment),
      ),
    );

    expect(listing.kind).toBe("cursorLost");
    expect(listing.cursor).toBeUndefined();
  });

  test("GOOG-O3: a token-less final page never downgrades to a snapshot that claims coverage", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf([]));
    harness.fake.withholdSyncToken();

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment),
      ),
    );

    expect(listing.coverage).toBeUndefined();
    expect(listing.removals).toBeUndefined();
  });
});
