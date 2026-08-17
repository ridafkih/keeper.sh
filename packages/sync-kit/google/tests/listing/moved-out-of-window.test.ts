import { derivableRemovals } from "@keeper.sh/sync-conformance";
import { describe, expect, test } from "vitest";
import { withinGoogleWindow } from "../../src/window/membership";
import { cursorOf, knownMirrorOf, listingOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { foreignEvent, seedOf, timedItem } from "../support/items";

const insideTheWindow = () => [
  foreignEvent({ uid: "moved", start: "2026-03-10T09:00:00.000Z", end: "2026-03-10T10:00:00.000Z" }),
];

describe("an event moved out of the window is out of scope, not deleted", () => {
  test("GOOG-O11: an event moved past the window edge is reported outOfScope, never deleted", async () => {
    const harness = createHarness();
    const seeded = insideTheWindow();
    harness.fake.seedFromProvider(seedOf(seeded));
    const scope = scopeOver(marchWindow);
    const full = listingOf(
      await harness.provider.listChanges(
        { scope, resume: null },
        operationContext(harness.environment),
      ),
    );
    harness.fake.putItems([
      timedItem({
        id: "id-moved",
        uid: "moved",
        start: "2027-01-10T09:00:00.000Z",
        end: "2027-01-10T10:00:00.000Z",
        updated: "2026-03-11T01:00:00.000Z",
        etag: '"v2-moved"',
      }),
    ]);

    const delta = listingOf(
      await harness.provider.listChanges(
        { scope, resume: cursorOf(full) },
        operationContext(harness.environment),
      ),
    );

    expect(delta.removals).toEqual([{ kind: "outOfScope", id: { kind: "remoteEventId", value: "id-moved" } }]);
    expect(
      derivableRemovals({
        listing: delta,
        known: knownMirrorOf(seeded),
        withinWindow: withinGoogleWindow,
      }),
    ).toEqual([]);
  });

  test("GOOG-O11: an out-of-scope removal carries no uid to delete a mirror by", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(insideTheWindow()));
    const scope = scopeOver(marchWindow);
    const full = listingOf(
      await harness.provider.listChanges(
        { scope, resume: null },
        operationContext(harness.environment),
      ),
    );
    harness.fake.putItems([
      timedItem({
        id: "id-moved",
        uid: "moved",
        start: "2027-01-10T09:00:00.000Z",
        end: "2027-01-10T10:00:00.000Z",
        updated: "2026-03-11T01:00:00.000Z",
        etag: '"v2-moved"',
      }),
    ]);

    const delta = listingOf(
      await harness.provider.listChanges(
        { scope, resume: cursorOf(full) },
        operationContext(harness.environment),
      ),
    );

    const carried = (delta.removals ?? []).flatMap((removal) => {
      if (removal.kind === "outOfScope") {
        return [];
      }
      return [removal.uid.value];
    });
    expect(carried).toEqual([]);
  });
});
