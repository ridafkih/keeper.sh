import { derivableRemovals } from "@keeper.sh/sync-conformance";
import type { SyncCursor } from "@keeper.sh/sync-protocol";
import { describe, expect, test } from "vitest";
import { cursorVersion, encodeCursorValue } from "../../src/cursor/cursor";
import { requestShapeFingerprint } from "../../src/cursor/fingerprint";
import { withinGoogleWindow } from "../../src/window/membership";
import { knownMirrorOf, listingOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { foreignEvent, seedOf } from "../support/items";

const seeded = () => [
  foreignEvent({ uid: "held", start: "2026-03-07T09:00:00.000Z", end: "2026-03-07T10:00:00.000Z" }),
];

describe("a deliberate cursor invalidation takes the non-destructive path", () => {
  test("GOOG-O6: a cursor from an older adapter version is cursorLost and emits no removals", async () => {
    const harness = createHarness();
    const events = seeded();
    harness.fake.seedFromProvider(seedOf(events));
    const scope = scopeOver(marchWindow);
    const stale: SyncCursor = {
      kind: "syncCursor",
      value: encodeCursorValue({
        version: cursorVersion - 1,
        mode: "delta",
        windowFingerprint: requestShapeFingerprint(scope, "delta", harness.environment.hash),
        providerToken: "google-sync-token-1",
      }),
      scope,
    };

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope, resume: stale },
        operationContext(harness.environment),
      ),
    );

    expect(listing.kind).toBe("cursorLost");
    expect(
      derivableRemovals({
        listing,
        known: knownMirrorOf(events),
        withinWindow: withinGoogleWindow,
      }),
    ).toEqual([]);
  });

  test("GOOG-O6: a re-baseline after a version bump reads the calendar again rather than deleting it", async () => {
    const harness = createHarness();
    const events = seeded();
    harness.fake.seedFromProvider(seedOf(events));
    const scope = scopeOver(marchWindow);

    const rebaselined = listingOf(
      await harness.provider.listChanges(
        { scope, resume: null },
        operationContext(harness.environment),
      ),
    );

    expect(rebaselined.kind).toBe("snapshot");
    expect(rebaselined.events).toHaveLength(1);
  });
});
