import { describe, expect, test } from "vitest";
import {
  decodeStoredCanonicalEvent,
  sourceCoverageFrom,
  synthesizeSourceListing,
} from "../../src/index";
import {
  asOf,
  completeRead,
  mirrorWindow,
  slotIdentity,
  sourceCalendarA,
  storedCoverage,
  storedSourceEvent,
} from "../support/fixtures";

const identity = slotIdentity("evt-one", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");

const proofFrom = (recordedAt: string, maxCoverageAgeSeconds: number) =>
  sourceCoverageFrom({
    stored: storedCoverage({ recordedAt }),
    mirrorWindow,
    asOf,
    maxCoverageAgeSeconds,
  });

const listingWith = (proof: ReturnType<typeof sourceCoverageFrom>) =>
  synthesizeSourceListing({
    sourceCalendar: sourceCalendarA,
    mirrorWindow,
    storedSourceEvents: [storedSourceEvent({ identity })],
    completeness: completeRead(),
    proof,
    decodeStored: decodeStoredCanonicalEvent,
  });

describe("a synthesized listing claims only what it recorded", () => {
  test("SHADOW-I1: a listing synthesized without a coverage proof is partial", () => {
    const listing = listingWith(proofFrom("2026-05-01T00:00:00.000Z", 86_400));

    expect(listing.kind).toBe("partial");
    expect(listing.events.length).toBe(1);
  });

  test("SHADOW-I1: a listing synthesized under a proof is a snapshot", () => {
    const listing = listingWith(proofFrom("2026-06-15T11:30:00.000Z", 86_400));

    expect(listing.kind).toBe("snapshot");
  });

  test("SHADOW-I1: an unproven listing carries no removals and no cursor at runtime", () => {
    const listing = listingWith(proofFrom("2026-05-01T00:00:00.000Z", 86_400));

    expect(Reflect.get(listing, "removals")).toBeUndefined();
    expect(Reflect.get(listing, "cursor")).toBeUndefined();
    expect(Reflect.get(listing, "coverage")).toBeUndefined();
  });
});
