import { describe, expect, it } from "vitest";
import { buildWriteBackFieldSummary } from "@/features/dashboard/components/write-back-summary";

const SOURCE_NAME = "Personal";

const NO_EXCLUSIONS = {
  excludeEventDescription: false,
  excludeEventLocation: false,
  excludeEventName: false,
};

/*
 * packages/calendar/tests/core/sync/write-back-adopt-window-divergence.test.ts pins what
 * actually happens to an edit made to a copy Keeper.sh has not yet observed: it is
 * "neither written back to the original nor replaced on the copy", and the pair is left
 * "permanently diverged once the edit has been adopted". The sentence beside the control
 * has to describe that, not the replacement it used to promise.
 */
describe("what the dashboard says about an edit Keeper.sh has not yet observed", () => {
  it("does not promise the edit may be replaced", () => {
    const { adopted } = buildWriteBackFieldSummary(NO_EXCLUSIONS, SOURCE_NAME);

    expect(adopted).not.toMatch(/replaced/i);
  });

  it("says the edit stays on the copy and never reaches the original", () => {
    const { adopted } = buildWriteBackFieldSummary(NO_EXCLUSIONS, SOURCE_NAME);

    expect(adopted).toContain("is not written back");
    expect(adopted).toContain(SOURCE_NAME);
  });

  it("names switching two-way sync on as one of the moments it applies", () => {
    const { adopted } = buildWriteBackFieldSummary(NO_EXCLUSIONS, SOURCE_NAME);

    expect(adopted).toContain("switch");
  });

  it("says the two calendars stay different until the original changes", () => {
    const { adopted } = buildWriteBackFieldSummary(NO_EXCLUSIONS, SOURCE_NAME);

    expect(adopted).toContain("until the original changes again");
  });
});
