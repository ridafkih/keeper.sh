import { derivableRemovals } from "@keeper.sh/sync-conformance";
import { describe, expect, test } from "vitest";
import { withinGoogleWindow } from "../../src/window/membership";
import { cursorOf, knownMirrorOf, listingOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { hundredForeignEvents, seedOf } from "../support/items";

describe("a delta deletes only what Google named", () => {
  test("GOOG-O10: a delta naming one cancellation removes exactly one of a hundred stored identities", async () => {
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
    harness.fake.cancelItem("id-seed-7");

    const delta = listingOf(
      await harness.provider.listChanges(
        { scope, resume: cursorOf(full) },
        operationContext(harness.environment),
      ),
    );

    expect(delta.kind).toBe("delta");
    expect(
      derivableRemovals({
        listing: delta,
        known: knownMirrorOf(seeded),
        withinWindow: withinGoogleWindow,
      }),
    ).toEqual(["seed-7"]);
  });

  test("GOOG-O10: a quiet delta names nothing and removes nothing", async () => {
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

    const delta = listingOf(
      await harness.provider.listChanges(
        { scope, resume: cursorOf(full) },
        operationContext(harness.environment),
      ),
    );

    expect(delta.removals).toEqual([]);
    expect(
      derivableRemovals({
        listing: delta,
        known: knownMirrorOf(seeded),
        withinWindow: withinGoogleWindow,
      }),
    ).toEqual([]);
  });
});
