import { describe, expect, test } from "vitest";
import { cursorOf, listingOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { manyForeignEvents, seedOf } from "../support/items";

describe("a poll that reports nothing is a successful poll", () => {
  test("MS-O11: a delta round with no items advances the cursor and derives no removal", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(manyForeignEvents(2)));
    const first = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment),
      ),
    );
    harness.fake.seedFromProvider(seedOf(manyForeignEvents(2)));

    const second = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: cursorOf(first) },
        operationContext(harness.environment),
      ),
    );

    expect(second.kind).toBe("delta");
    expect(second.removals).toEqual([]);
    expect(cursorOf(second).value).not.toBe(cursorOf(first).value);
  });
});
