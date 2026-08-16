import { describe, expect, it } from "vitest";
import { resolveModeSelection } from "@/lib/write-back-answers";
import { WRITE_BACK_STATE_COPY } from "@/lib/write-back-copy";

const PLAN_DOWNGRADED = "plan_downgraded";

/*
 * A lapsed plan is the one pause the user cannot answer and does not have to: the two-way
 * controls are disabled while the plan is lapsed, and the next pass on a plan that covers
 * two-way sync clears the pause on its own (restorePlanQuarantinedPairs, packages/sync/
 * src/sync-user.ts). Copy that asks the user to re-pick the mode is an instruction they
 * cannot follow and a promise that two-way sync — deletions included — stays off until they
 * do, when in fact it is live again the moment the plan is back.
 */
describe("the lapsed-plan pause tells the truth about how it ends", () => {
  it("does not ask the user to re-pick a mode they cannot pick", () => {
    expect(WRITE_BACK_STATE_COPY[PLAN_DOWNGRADED]).not.toContain("Pick the two-way option");
  });

  it("says the pause lifts by itself when the plan covers two-way sync again", () => {
    expect(WRITE_BACK_STATE_COPY[PLAN_DOWNGRADED]).toContain("starts again on its own");
  });

  it("names the one control that is still available for keeping it off", () => {
    expect(WRITE_BACK_STATE_COPY[PLAN_DOWNGRADED]).toContain("One-way");
  });

  it("refuses the two-way press the old copy instructed", () => {
    expect(resolveModeSelection({
      locked: true,
      nextMode: "edits_and_deletes",
      selectedMode: "edits_and_deletes",
      status: { reason: PLAN_DOWNGRADED, state: "quarantined" },
      writableSource: true,
    })).toBe("ignore");
  });
});
