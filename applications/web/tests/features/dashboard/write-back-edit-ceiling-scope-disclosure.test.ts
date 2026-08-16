import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TWO_WAY_EDIT_ABSOLUTE_CEILING } from "@keeper.sh/constants";
import { describe, expect, it } from "vitest";
import { buildWriteBackFieldSummary } from "@/features/dashboard/components/write-back-summary";

const TWO_WAY_DOC = join(import.meta.dirname, "../../../src/content/docs/two-way-sync.mdx");

const SOURCE_NAME = "Personal";
const NO_EXCLUSIONS = {
  excludeEventDescription: false,
  excludeEventLocation: false,
  excludeEventName: false,
};

/*
 * resolveTrippedSourceCalendarIds counts the whole destination's pending write-backs
 * against the ceiling before it counts any single calendar's, and trips every calendar
 * with a candidate when that fires. Two calendars feeding one receiving calendar is the
 * ordinary shape of this product, so a sentence naming only the calendar whose page it is
 * printed on hands the user a number that is not the one the classifier holds at: six
 * edits on each of two calendars is inside the disclosed rule twice over and loses all
 * twelve edits. The sentence has to state the scope it is counted at.
 */
describe("the batch ceiling is disclosed at the scope it is enforced", () => {
  it("says the count is taken across every calendar sharing the receiving calendar", () => {
    const { batch } = buildWriteBackFieldSummary(NO_EXCLUSIONS, SOURCE_NAME);

    expect(batch).toContain(String(TWO_WAY_EDIT_ABSOLUTE_CEILING));
    expect(batch).toContain("across every calendar copied into the same receiving calendar");
  });

  it("does not promise the ceiling applies to this calendar alone", () => {
    const { batch } = buildWriteBackFieldSummary(NO_EXCLUSIONS, SOURCE_NAME);

    expect(batch).not.toContain("of the same calendar");
    expect(batch).toContain("not just this one");
  });

  it("says the same thing in the documentation that repeats the rule", () => {
    const doc = readFileSync(TWO_WAY_DOC, "utf8");

    expect(doc).not.toContain(
      `Editing more than ${TWO_WAY_EDIT_ABSOLUTE_CEILING} copies of the same calendar`,
    );
    expect(doc).toContain("across every calendar copied into it, and not per calendar");
  });
});
