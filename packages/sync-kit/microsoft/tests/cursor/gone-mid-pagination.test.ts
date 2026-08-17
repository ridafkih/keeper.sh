import { describe, expect, test } from "vitest";
import { listingOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { manyForeignEvents, seedOf } from "../support/items";

describe("a 410 arriving mid-walk throws away the pages already collected", () => {
  test("MS-O2: a 410 on the third page discards the two pages already collected", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(manyForeignEvents(9)));
    harness.fake.pageEvery(3);
    harness.fake.failListOn({ onCall: 3, status: 410, code: "resyncRequired" });

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment, { deadlineMs: 5000 }),
      ),
    );

    expect(listing.kind).toBe("cursorLost");
    expect(listing.events).toBeUndefined();
    expect(listing.cursor).toBeUndefined();
  }, 30_000);

  test("MS-O2: the walk that hit the 410 still reached exactly three pages", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(manyForeignEvents(9)));
    harness.fake.pageEvery(3);
    harness.fake.failListOn({ onCall: 3, status: 410, code: "resyncRequired" });

    await harness.provider.listChanges(
      { scope: scopeOver(marchWindow), resume: null },
      operationContext(harness.environment, { deadlineMs: 5000 }),
    );

    expect(harness.fake.listCallCount()).toBe(3);
  }, 30_000);
});
