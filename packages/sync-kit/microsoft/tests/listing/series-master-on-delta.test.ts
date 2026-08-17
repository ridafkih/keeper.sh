import { describe, expect, test } from "vitest";
import { cursorOf, listingOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { manyForeignEvents, seedOf, seriesMasterItem } from "../support/items";

describe("a series master on a delta page is never ingested beside expanded instances", () => {
  test("MS-O7: a seriesMaster on a delta page collapses the whole listing to cursorLost", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(manyForeignEvents(2)));
    const first = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment),
      ),
    );
    harness.fake.putItems([seriesMasterItem("master-one", "2026-03-16T09:00:00.0000000")]);

    const second = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: cursorOf(first) },
        operationContext(harness.environment),
      ),
    );

    expect(second.kind).toBe("cursorLost");
    expect(second.events).toBeUndefined();
    expect(second.removals).toBeUndefined();
  });
});
