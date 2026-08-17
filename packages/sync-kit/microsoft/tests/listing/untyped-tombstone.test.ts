import { describe, expect, test } from "vitest";
import { readRemoved } from "../../src/decode/removed";
import { cursorOf, listingOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { manyForeignEvents, removedItem, seedOf } from "../support/items";

describe("a tombstone with no type is a resync trigger, not a deletion", () => {
  test("MS-O8: an @removed entry with no type collapses the listing to cursorLost rather than deleting", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(manyForeignEvents(2)));
    const first = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment),
      ),
    );
    harness.fake.putRaw([removedItem("id-seed-0", null)]);

    const second = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: cursorOf(first) },
        operationContext(harness.environment),
      ),
    );

    expect(second.kind).toBe("cursorLost");
    expect(second.removals).toBeUndefined();
  });

  test("MS-O8: a typed removal and an untyped one are different readings", () => {
    expect(readRemoved(removedItem("id-one", "deleted")).kind).toBe("deleted");
    expect(readRemoved(removedItem("id-one", null)).kind).toBe("untyped");
  });
});
