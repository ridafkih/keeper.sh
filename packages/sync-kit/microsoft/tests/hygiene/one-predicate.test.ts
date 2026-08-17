import { describe, expect, test } from "vitest";
import { withinMicrosoftWindow } from "../../src/window/membership";
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

describe("exactly one module decides window membership", () => {
  test("MS-H2: only one module decides window membership", async () => {
    const decoders = await filesMatchingPattern("src/decode", windowBoundComparison);
    const listing = await filesMatchingPattern("src/listing", windowBoundComparison);
    const files = await sourceFiles("src");

    expect(decoders).toEqual([]);
    expect(listing.filter((file) => file !== "src/listing/coverage.ts")).toEqual([]);
    expect(files).toContain("src/window/membership.ts");
    expect(withinMicrosoftWindow(marchWindow, zeroDurationOnTheLowerEdge)).toBe(true);
  });

  test("MS-H2: a degenerate range is judged by the instant it names", () => {
    expect(withinMicrosoftWindow(marchWindow, invertedRangeStartingInside)).toBe(true);
    expect(
      withinMicrosoftWindow(marchWindow, {
        kind: "timed",
        start: { kind: "instant", value: "2026-05-01T09:00:00.000Z" },
        end: { kind: "instant", value: "2026-05-01T10:00:00.000Z" },
        zone: null,
      }),
    ).toBe(false);
  });
});
