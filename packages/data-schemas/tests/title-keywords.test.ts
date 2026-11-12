import { describe, expect, it } from "vitest";
import {
  MAX_EXCLUDE_TITLE_KEYWORDS,
  MAX_EXCLUDE_TITLE_KEYWORD_LENGTH,
  normalizeTitleKeywords,
} from "../src/index";

describe("normalizeTitleKeywords", () => {
  it("trims keywords and drops blank entries", () => {
    expect(normalizeTitleKeywords(["  Zoom Room ", "   ", "Placeholder"])).toEqual([
      "Zoom Room",
      "Placeholder",
    ]);
  });

  it("keeps the first spelling of keywords that differ only in case", () => {
    expect(normalizeTitleKeywords(["Zoom", "zoom", "standup"])).toEqual(["Zoom", "standup"]);
  });

  it("clamps keyword length and count to the limits the API accepts", () => {
    const keywords = normalizeTitleKeywords([
      `${"a".repeat(MAX_EXCLUDE_TITLE_KEYWORD_LENGTH)}b`,
      ...Array.from({ length: MAX_EXCLUDE_TITLE_KEYWORDS }, (_unused, index) => `k${index}`),
    ]);

    expect(keywords).toHaveLength(MAX_EXCLUDE_TITLE_KEYWORDS);
    expect(keywords[0]).toBe("a".repeat(MAX_EXCLUDE_TITLE_KEYWORD_LENGTH));
  });

  it("de-duplicates after clamping so the count limit holds", () => {
    const keywords = normalizeTitleKeywords([
      ...Array.from({ length: MAX_EXCLUDE_TITLE_KEYWORDS }, () => "same"),
      "other",
    ]);

    expect(keywords).toEqual(["same", "other"]);
  });
});
