import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TWO_WAY_EDIT_ABSOLUTE_CEILING } from "@keeper.sh/constants";
import { describe, expect, it } from "vitest";

/*
 * A pass that sees more edited copies than the ceiling writes none of them back and rebuilds
 * all of them. Asserting the number against the constant rather than the prose is what stops
 * the page quoting a ceiling the classifier no longer holds at.
 */
const DOC = readFileSync(
  join(import.meta.dirname, "../../../src/content/docs/two-way-sync.mdx"),
  "utf8",
);

describe("what the two-way sync page says about an oversized batch", () => {
  it("names the number of copies that may be edited at once", () => {
    expect(DOC).toContain(String(TWO_WAY_EDIT_ABSOLUTE_CEILING));
  });

  it("says the edits in an oversized batch are not written back", () => {
    expect(DOC).toMatch(/none of those edits reach the original/i);
  });

  it("says the copies are rebuilt and two-way sync pauses", () => {
    expect(DOC).toMatch(/rebuilt from it/i);
    expect(DOC.toLowerCase()).toContain("paus");
  });
});
