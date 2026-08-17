import { derivableRemovals } from "@keeper.sh/sync-conformance";
import { describe, expect, test } from "vitest";
import { withinGoogleWindow } from "../../src/window/membership";
import { cursorOf, knownMirrorOf, listingOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { hundredForeignEvents, seedOf } from "../support/items";

describe("a 410 on a listing is cursor loss, never an empty delta", () => {
  test("GOOG-O1: a 410 on the first page yields cursorLost, zero removals and no cursor", async () => {
    const harness = createHarness();
    const seeded = hundredForeignEvents();
    harness.fake.seedFromProvider(seedOf(seeded));
    const scope = scopeOver(marchWindow);

    const full = listingOf(
      await harness.provider.listChanges(
        { scope, resume: null },
        operationContext(harness.environment),
      ),
    );
    harness.fake.failListOn({
      onCall: 2,
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
    expect(delta.cursor).toBeUndefined();
    expect(
      derivableRemovals({
        listing: delta,
        known: knownMirrorOf(seeded),
        withinWindow: withinGoogleWindow,
      }),
    ).toEqual([]);
  });

  test("GOOG-O1: the hundred seeded identities survive the invalidated cursor", async () => {
    const harness = createHarness();
    const seeded = hundredForeignEvents();
    harness.fake.seedFromProvider(seedOf(seeded));
    harness.fake.failListOn({
      onCall: 1,
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
    expect(listing.removals).toBeUndefined();
    expect(listing.events).toBeUndefined();
    expect(harness.fake.items()).toHaveLength(100);
  });
});
