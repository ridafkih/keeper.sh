import { describe, expect, test } from "vitest";
import {
  decodeStoredCanonicalEvent,
  sourceCoverageFrom,
  synthesizeSourceListing,
} from "../../src/index";
import { filesMatching } from "../support/sources";
import {
  asOf,
  completeRead,
  mirrorWindow,
  sourceCalendarA,
  storedCoverage,
} from "../support/fixtures";

const provenProof = () =>
  sourceCoverageFrom({
    stored: storedCoverage(),
    mirrorWindow,
    asOf,
    maxCoverageAgeSeconds: 86_400,
  });

describe("the whole-feed coverage claim", () => {
  test("SHADOW-I31: no source file imports coverageForWholeFeed", async () => {
    expect(await filesMatching("src", "coverageForWholeFeed")).toEqual([]);

    const listing = synthesizeSourceListing({
      sourceCalendar: sourceCalendarA,
      mirrorWindow,
      storedSourceEvents: [],
      completeness: completeRead(),
      proof: provenProof(),
      decodeStored: decodeStoredCanonicalEvent,
    });

    expect(listing.kind).toBe("snapshot");
    expect(JSON.stringify(listing)).not.toContain("1800-01-01");
    expect(JSON.stringify(listing)).not.toContain("2400-01-01");
  });

  test("SHADOW-I31: a proven listing claims the recorded intersection, never a feed-wide span", () => {
    const listing = synthesizeSourceListing({
      sourceCalendar: sourceCalendarA,
      mirrorWindow,
      storedSourceEvents: [],
      completeness: completeRead(),
      proof: provenProof(),
      decodeStored: decodeStoredCanonicalEvent,
    });
    if (listing.kind !== "snapshot") {
      throw new Error(`expected a snapshot listing, got ${listing.kind}`);
    }

    expect(listing.coverage.covered.start.value).toBe(mirrorWindow.start.value);
    expect(listing.coverage.covered.end.value).toBe(mirrorWindow.end.value);
  });
});
