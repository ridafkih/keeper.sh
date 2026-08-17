import { derivableRemovals } from "@keeper.sh/sync-conformance";
import { describe, expect, test } from "vitest";
import { withinGoogleWindow } from "../../src/window/membership";
import { knownMirrorOf, listingOf } from "../support/expect";
import {
  createHarness,
  marchWindow,
  operationContext,
  scopeOver,
} from "../support/harness";
import { foreignEvent, seedOf } from "../support/items";

const SEEDED = 25;
const ONE_PER_PAGE = 1;

const seededEvents = () => Array.from({ length: SEEDED }, (unused, index) => foreignEvent({
  uid: `seed-${index}`,
  start: `2026-03-${String((index % 27) + 1).padStart(2, "0")}T09:00:00.000Z`,
  end: `2026-03-${String((index % 27) + 1).padStart(2, "0")}T10:00:00.000Z`,
}));

/*
 * The walk truncates at the page ceiling and hands back a continuation. Resuming it reads
 * only the pages after that point, so a listing claiming the requested window would turn
 * every event before the resume point into an absence — and absence on a snapshot is a
 * deletion of an event that is plainly still there.
 */
describe("a walk resumed from a continuation", () => {
  test("GOOG-O17: does not make the pages it already handed back derivable as removals", async () => {
    const harness = createHarness();
    const seeded = seededEvents();
    harness.fake.seedFromProvider(seedOf(seeded));
    const scope = scopeOver(marchWindow);

    harness.fake.pageEvery(ONE_PER_PAGE);
    const first = listingOf(
      await harness.provider.listChanges(
        { scope, resume: null },
        operationContext(harness.environment),
      ),
    );

    expect(first.kind).toBe("partial");
    if (first.kind !== "partial") {
      return;
    }

    harness.fake.pageEvery(SEEDED * 2);
    const resumed = listingOf(
      await harness.provider.listChanges(
        { scope, resume: first.continuation },
        operationContext(harness.environment),
      ),
    );

    expect(derivableRemovals({
      listing: resumed,
      known: knownMirrorOf(seeded),
      withinWindow: withinGoogleWindow,
    })).toEqual([]);
  });
});
