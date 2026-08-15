import { describe, expect, it } from "vitest";
import { formatStarCount } from "../../../src/features/marketing/github-stars";

describe("formatStarCount", () => {
  it("shortens large counts", () => {
    expect(formatStarCount(1243)).toBe("1.2K stars");
  });

  it("keeps the label singular for a single star", () => {
    expect(formatStarCount(1)).toBe("1 star");
  });

  it("pluralises every other count", () => {
    expect(formatStarCount(0)).toBe("0 stars");
    expect(formatStarCount(2)).toBe("2 stars");
  });
});
