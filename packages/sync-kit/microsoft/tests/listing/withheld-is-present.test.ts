import { derivableRemovals } from "@keeper.sh/sync-conformance";
import { describe, expect, test } from "vitest";
import { withinMicrosoftWindow } from "../../src/window/membership";
import { knownMirrorOf, listingOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { foreignEvent, seedOf, timedItem } from "../support/items";

const readable = foreignEvent({
  uid: "readable",
  start: "2026-03-12T09:00:00.000Z",
  end: "2026-03-12T10:00:00.000Z",
});

const unbuildable = timedItem({
  id: "id-unbuildable",
  uid: "unbuildable",
  start: "2026-03-13T09:00:00.0000000",
  end: "2026-03-13T10:00:00.0000000",
  originalStartTimeZone: "Nonsense Standard Time",
  timeZone: "Nonsense Standard Time",
});

describe("an event we could not build is still an event the calendar holds", () => {
  test("MS-O14: a withheld identity shields its mirror from the absence axis", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf([readable]));
    harness.fake.putItems([unbuildable]);

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment),
      ),
    );

    expect(listing.withheld?.map((entry) => entry.reason)).toEqual(["unresolvableTimeZone"]);
    expect(
      derivableRemovals({
        listing,
        known: knownMirrorOf([
          readable,
          foreignEvent({
            uid: "unbuildable",
            start: "2026-03-13T09:00:00.000Z",
            end: "2026-03-13T10:00:00.000Z",
          }),
        ]),
        withinWindow: withinMicrosoftWindow,
      }),
    ).toEqual([]);
  });
});
