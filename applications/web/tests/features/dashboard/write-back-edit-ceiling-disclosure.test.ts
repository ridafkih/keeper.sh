import { TWO_WAY_EDIT_ABSOLUTE_CEILING } from "@keeper.sh/constants";
import { describe, expect, it } from "vitest";
import { buildWriteBackFieldSummary } from "@/features/dashboard/components/write-back-summary";

const SOURCE_NAME = "Personal";
const NO_EXCLUSIONS = {
  excludeEventDescription: false,
  excludeEventLocation: false,
  excludeEventName: false,
};

/*
 * One pass that sees more than TWO_WAY_EDIT_ABSOLUTE_CEILING edited copies for a source
 * calendar writes none of them back: the whole batch is read as something moving the
 * calendar, every copy is rebuilt from the original and the pair is paused
 * (resolveTrippedSourceCalendarIds in packages/calendar/src/core/sync/write-back.ts). A
 * summary that lists every other exception but not this one lets a user drag a day of
 * meetings and find out afterwards, with the edits already gone.
 */
describe("the summary discloses the per-pass edit ceiling", () => {
  it("names the number of copies that may be edited at once", () => {
    const { batch } = buildWriteBackFieldSummary(NO_EXCLUSIONS, SOURCE_NAME);

    expect(batch).toContain(String(TWO_WAY_EDIT_ABSOLUTE_CEILING));
  });

  it("says the edits in an oversized batch are not written back", () => {
    const { batch } = buildWriteBackFieldSummary(NO_EXCLUSIONS, SOURCE_NAME);

    expect(batch).toContain("none of those edits");
    expect(batch).toContain(SOURCE_NAME);
  });
});
