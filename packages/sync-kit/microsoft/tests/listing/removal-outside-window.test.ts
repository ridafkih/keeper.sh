import { describe, expect, test } from "vitest";
import { cursorOf, listingOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { manyForeignEvents, removedItem, seedOf } from "../support/items";

describe("a removal the walk never covered is not authority to delete", () => {
  test("MS-O9: an @removed naming an id outside the walked window is outOfScope, not an authoritative removal", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(manyForeignEvents(2)));
    const first = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment),
      ),
    );
    harness.fake.putRaw([removedItem("id-never-walked", "deleted")]);

    const second = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: cursorOf(first) },
        operationContext(harness.environment),
      ),
    );

    expect(second.kind).toBe("delta");
    expect(second.removals?.map((removal) => removal.kind)).toEqual(["outOfScope"]);
  });
});
