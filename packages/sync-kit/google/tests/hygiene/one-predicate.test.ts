import { describe, expect, test } from "vitest";
import { withinGoogleWindow } from "../../src/window/membership";
import { marchWindow } from "../support/harness";
import { filesMatchingPattern, sourceFiles } from "../support/sources";

const windowBoundComparison = /window\.(start|end)|scope\.window/;

const zeroDurationOnTheLowerEdge = {
  kind: "timed",
  start: marchWindow.start,
  end: marchWindow.start,
  zone: null,
} as const;

const invertedRangeStartingInside = {
  kind: "timed",
  start: { kind: "instant", value: "2026-03-15T09:00:00.000Z" },
  end: { kind: "instant", value: "2026-03-15T08:00:00.000Z" },
  zone: null,
} as const;

describe("exactly one window predicate", () => {
  test("GOOG-O17: no module compares a window bound except the predicate module", async () => {
    const comparisons = await filesMatchingPattern("src/decode", windowBoundComparison);
    const listing = await filesMatchingPattern("src/listing", windowBoundComparison);
    const files = await sourceFiles("src");

    expect(comparisons).toEqual([]);
    expect(listing.filter((file) => file !== "src/listing/coverage.ts")).toEqual([]);
    expect(files).toContain("src/window/membership.ts");
    expect(withinGoogleWindow(marchWindow, zeroDurationOnTheLowerEdge)).toBe(true);
  });

  test("GOOG-O17: a zero-duration event on the lower edge is inside the window", () => {
    expect(withinGoogleWindow(marchWindow, zeroDurationOnTheLowerEdge)).toBe(true);
  });

  test("GOOG-O17: an inverted range is judged by the instant it names", () => {
    expect(withinGoogleWindow(marchWindow, invertedRangeStartingInside)).toBe(true);
  });

  test("GOOG-O17: an event entirely after the window is outside it", () => {
    expect(
      withinGoogleWindow(marchWindow, {
        kind: "timed",
        start: { kind: "instant", value: "2026-05-01T09:00:00.000Z" },
        end: { kind: "instant", value: "2026-05-01T10:00:00.000Z" },
        zone: null,
      }),
    ).toBe(false);
  });
});
