import { describe, expect, it } from "vitest";
import { resolveModeSelection } from "@/lib/write-back-answers";

describe("re-picking the mode a paused pair already carries", () => {
  /*
   * Nothing in the product ever moves a quarantined pair back to ok on its own, and the
   * dashboard renders the stored mode as selected, so an early return on "same mode"
   * leaves the user pressing the only control they have with nothing happening.
   */
  it("restarts a quarantined pair when the selected mode is pressed again", () => {
    expect(resolveModeSelection({
      locked: false,
      nextMode: "edits",
      selectedMode: "edits",
      status: { reason: "plan_downgraded", state: "quarantined" },
      writableSource: true,
    })).toBe("commit");
  });

  it("asks again before restarting a quarantined pair that deletes originals", () => {
    expect(resolveModeSelection({
      locked: false,
      nextMode: "edits_and_deletes",
      selectedMode: "edits_and_deletes",
      status: { reason: "bulk_edit_breaker", state: "quarantined" },
      writableSource: true,
    })).toBe("confirm_deletions");
  });

  /*
   * A pair holding a question about copies that vanished is answered through the
   * confirmation, never through the mode control: committing the mode clears the state
   * the answer applies to without ever asking it.
   */
  it("does nothing when the pair is waiting on a delete confirmation", () => {
    expect(resolveModeSelection({
      locked: false,
      nextMode: "edits_and_deletes",
      selectedMode: "edits_and_deletes",
      status: { reason: "all_copies_missing", state: "delete_confirmation_required" },
      writableSource: true,
    })).toBe("ignore");
  });

  it("does nothing when a healthy pair is asked for the mode it already has", () => {
    expect(resolveModeSelection({
      locked: false,
      nextMode: "edits",
      selectedMode: "edits",
      status: { reason: null, state: "ok" },
      writableSource: true,
    })).toBe("ignore");
  });

  it("still refuses to turn two-way sync on without the plan", () => {
    expect(resolveModeSelection({
      locked: true,
      nextMode: "edits",
      selectedMode: "off",
      status: null,
      writableSource: true,
    })).toBe("ignore");
    expect(resolveModeSelection({
      locked: true,
      nextMode: "off",
      selectedMode: "edits",
      status: { reason: "plan_downgraded", state: "quarantined" },
      writableSource: true,
    })).toBe("commit");
  });

  it("commits an ordinary change of mode", () => {
    expect(resolveModeSelection({
      locked: false,
      nextMode: "edits",
      selectedMode: "off",
      status: null,
      writableSource: true,
    })).toBe("commit");
    expect(resolveModeSelection({
      locked: false,
      nextMode: "edits_and_deletes",
      selectedMode: "edits",
      status: null,
      writableSource: true,
    })).toBe("confirm_deletions");
  });
});
