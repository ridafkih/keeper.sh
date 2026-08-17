import { describe, expect, test } from "vitest";
import { readDeltaLink } from "../../src/cursor/delta-link";
import { listingOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { manyForeignEvents, seedOf } from "../support/items";

describe("a walk that ends with no successor link is cursor loss", () => {
  test("MS-O3: a final page carrying neither link is cursorLost, not a delta", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(manyForeignEvents(2)));
    harness.fake.withholdDeltaLink();

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment),
      ),
    );

    expect(listing.kind).toBe("cursorLost");
    expect(listing.cursor).toBeUndefined();
  });

  test("MS-O3: a page carrying neither link reads as lost, never as an empty string", () => {
    expect(readDeltaLink({ value: [] })).toEqual({ kind: "lost" });
  });
});
