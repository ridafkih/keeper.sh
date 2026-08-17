import { describe, expect, test } from "vitest";
import { cursorOf, listingOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { manyForeignEvents, removedItem, seedOf } from "../support/items";

describe("a cancelled occurrence and a deleted tombstone are both removals, and different ones", () => {
  test("MS-O10: a cancelled occurrence and a deleted tombstone are distinct authoritative removals", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(manyForeignEvents(2)));
    const first = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment),
      ),
    );
    harness.fake.mutateItem("id-seed-0", { isCancelled: true });
    harness.fake.putRaw([removedItem("id-seed-1", "deleted")]);

    const second = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: cursorOf(first) },
        operationContext(harness.environment),
      ),
    );

    expect(second.removals?.map((removal) => removal.kind).toSorted()).toEqual([
      "cancelled",
      "deleted",
    ]);
  });
});
