import { TWO_WAY_WRITE_BACK_DAILY_CAP } from "@keeper.sh/constants";
import { describe, expect, it } from "vitest";
import { buildWriteBackFieldSummary } from "@/features/dashboard/components/write-back-summary";
import { WRITE_BACK_STATE_COPY } from "@/lib/write-back-copy";

const SOURCE_NAME = "Personal";
const NO_EXCLUSIONS = {
  excludeEventDescription: false,
  excludeEventLocation: false,
  excludeEventName: false,
};

/*
 * Editing the same copy often enough — five times in close succession, or twenty times in
 * a day — reverts the whole connection to one-way and rebuilds every copy on it from the
 * original, taking the last edit and any other pending ones with it
 * (buildEpochAssignment in packages/sync/src/write-back.ts, applyUpdate in
 * packages/sync/src/write-back-pass.ts). Nothing in the product says there is a limit on
 * how often one event may be edited, and the summary already states every other exception
 * — the fields, the source-wins rule, the adopt window, the per-pass batch ceiling — so
 * leaving this one out is exactly what makes it a surprise.
 */
describe("the summary discloses the per-event repeat-edit ceiling", () => {
  it("names how many times one copy may be edited in a day", () => {
    const { repeated } = buildWriteBackFieldSummary(NO_EXCLUSIONS, SOURCE_NAME);

    expect(repeated).toContain(String(TWO_WAY_WRITE_BACK_DAILY_CAP));
  });

  it("says what repeatedly editing one copy costs", () => {
    const { repeated } = buildWriteBackFieldSummary(NO_EXCLUSIONS, SOURCE_NAME);

    expect(repeated).toContain(SOURCE_NAME);
    expect(repeated.toLowerCase()).toContain("paus");
  });
});

/*
 * The same pause is reached by a person nudging one meeting a few times in a row, so copy
 * that states the copies changed by themselves sends that user to look at the destination
 * calendar and at Keeper.sh, rather than at the thing they actually did.
 */
describe("the pause a repeated edit causes does not blame the copies", () => {
  it("does not tell the user their copies changed on their own", () => {
    expect(WRITE_BACK_STATE_COPY.runaway_write_back)
      .not.toContain("changing on their own");
  });

  it("names editing the same copy over and over as a way to reach it", () => {
    expect(WRITE_BACK_STATE_COPY.runaway_write_back?.toLowerCase())
      .toContain("same copy");
  });
});
