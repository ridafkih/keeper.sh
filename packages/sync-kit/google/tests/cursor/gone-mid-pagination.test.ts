import { describe, expect, test } from "vitest";
import { cursorOf, listingOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { foreignEvent, seedOf } from "../support/items";

const threePagesOfEvents = () => [
  foreignEvent({ uid: "page-one", start: "2026-03-02T09:00:00.000Z", end: "2026-03-02T10:00:00.000Z" }),
  foreignEvent({ uid: "page-two", start: "2026-03-03T09:00:00.000Z", end: "2026-03-03T10:00:00.000Z" }),
  foreignEvent({ uid: "page-three", start: "2026-03-04T09:00:00.000Z", end: "2026-03-04T10:00:00.000Z" }),
];

describe("a 410 part way through pagination discards what it collected", () => {
  test("GOOG-O2: a 410 on the third page discards the two pages already collected", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(threePagesOfEvents()));
    harness.fake.pageEvery(1);
    const scope = scopeOver(marchWindow);
    const full = listingOf(
      await harness.provider.listChanges(
        { scope, resume: null },
        operationContext(harness.environment),
      ),
    );
    const listCallsBeforeDelta = harness.fake.listCallCount();
    harness.fake.failListOn({
      onCall: listCallsBeforeDelta + 3,
      status: 410,
      reason: "fullSyncRequired",
      bodyShape: "json",
    });

    const delta = listingOf(
      await harness.provider.listChanges(
        { scope, resume: cursorOf(full) },
        operationContext(harness.environment),
      ),
    );

    expect(delta.kind).toBe("cursorLost");
    expect(delta.events).toBeUndefined();
    expect(delta.cursor).toBeUndefined();
  });

  test("GOOG-O2: the invalidated walk still reached the third page before it gave up", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(threePagesOfEvents()));
    harness.fake.pageEvery(1);
    harness.fake.failListOn({
      onCall: 3,
      status: 410,
      reason: "fullSyncRequired",
      bodyShape: "json",
    });

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment),
      ),
    );

    expect(listing.kind).toBe("cursorLost");
    expect(harness.fake.listCallCount()).toBe(3);
  });
});
