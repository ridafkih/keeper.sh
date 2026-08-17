import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * packages/calendar/tests/core/sync/write-back-adopt-window-divergence.test.ts pins what
 * happens to an edit made to a copy Keeper.sh has not yet observed: it is neither written
 * back to the original nor replaced on the copy, and the pair stays diverged. The page has
 * to describe that, not the replacement it does not do.
 */
const DOC = readFileSync(
  join(import.meta.dirname, "../../../src/content/docs/two-way-sync.mdx"),
  "utf8",
);

const ADOPT_WINDOW = DOC.slice(DOC.indexOf("neither written back nor undone"));

describe("what the two-way sync page says about an edit it has not yet observed", () => {
  it("says the edit is neither written back nor undone", () => {
    expect(DOC).toContain("neither written back nor undone");
  });

  it("names switching two-way sync on as one of the moments it applies", () => {
    expect(ADOPT_WINDOW).toMatch(/switched on/i);
  });

  it("says the two calendars stay different until the original changes", () => {
    expect(ADOPT_WINDOW).toContain("until the original changes again");
  });
});
