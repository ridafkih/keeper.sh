import { derivableRemovals } from "@keeper.sh/sync-conformance";
import { describe, expect, test } from "vitest";
import { provenCoverage } from "../../src/listing/coverage";
import { googleListingLimits } from "../../src/limits";
import { withinGoogleWindow } from "../../src/window/membership";
import { knownMirrorOf, listingOf } from "../support/expect";
import {
  createHarness,
  decadeWindow,
  googleCalendar,
  operationContext,
  scopeOver,
} from "../support/harness";
import { foreignEvent, seedOf } from "../support/items";

const insideTheUnreadBand = () => [
  foreignEvent({ uid: "far-future", start: "2029-06-01T09:00:00.000Z", end: "2029-06-01T10:00:00.000Z" }),
];

describe("coverage is proven, never claimed", () => {
  test("GOOG-O16: a decade request proves at most one year of coverage", async () => {
    const harness = createHarness();
    const seeded = insideTheUnreadBand();
    harness.fake.seedFromProvider(seedOf(seeded));
    const scope = scopeOver(decadeWindow);

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope, resume: null },
        operationContext(harness.environment),
      ),
    );

    expect(listing.coverage?.covered.end.value).not.toBe(scope.window.end.value);
    expect(
      derivableRemovals({
        listing,
        known: knownMirrorOf(seeded),
        withinWindow: withinGoogleWindow,
      }),
    ).toEqual([]);
  });

  test("GOOG-O16: the clamp is the named maximum coverage, not an incidental bound", () => {
    const coverage = provenCoverage(decadeWindow, googleCalendar);

    const span = Date.parse(coverage.covered.end.value) - Date.parse(coverage.covered.start.value);
    expect(span).toBe(googleListingLimits.maximumCoverageMs);
    expect(coverage.calendar).toEqual(googleCalendar);
  });

  test("GOOG-O16: an inverted request proves nothing at all", () => {
    const coverage = provenCoverage(
      { start: decadeWindow.end, end: decadeWindow.start },
      googleCalendar,
    );

    expect(coverage.covered.start.value).toBe(coverage.covered.end.value);
  });
});
