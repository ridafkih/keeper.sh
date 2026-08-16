import { describe, expect, it } from "vitest";
import { resolveModeSelection } from "@/lib/write-back-answers";
import { supportsWriteBack } from "@/lib/write-back-copy";

/*
 * A calendar added by link is stored with calendarType "ical" and the API refuses two-way
 * on it outright. Offering the control anyway sends the user through the deletion-consent
 * modal to a request that answers 400, and the optimistic mode is rolled back with nothing
 * said — so the calendar reads as if the button simply does not work.
 */
describe("a source calendar that can never be written to", () => {
  it("is recognised from the calendar it is", () => {
    expect(supportsWriteBack({ calendarType: "ical", capabilities: ["pull"] })).toBe(false);
    expect(supportsWriteBack({ calendarType: "google", capabilities: ["push"] })).toBe(false);
    expect(supportsWriteBack({ calendarType: "google", capabilities: ["pull", "push"] }))
      .toBe(true);
  });

  it("does nothing when two-way is picked on it", () => {
    expect(resolveModeSelection({
      locked: false,
      nextMode: "edits",
      selectedMode: "off",
      status: null,
      writableSource: false,
    })).toBe("ignore");
  });

  it("does not open the deletion consent modal either", () => {
    expect(resolveModeSelection({
      locked: false,
      nextMode: "edits_and_deletes",
      selectedMode: "off",
      status: null,
      writableSource: false,
    })).toBe("ignore");
  });

  it("still lets the pair be put back to one-way", () => {
    expect(resolveModeSelection({
      locked: false,
      nextMode: "off",
      selectedMode: "edits",
      status: null,
      writableSource: false,
    })).toBe("commit");
  });

  it("leaves a writable source alone", () => {
    expect(resolveModeSelection({
      locked: false,
      nextMode: "edits",
      selectedMode: "off",
      status: null,
      writableSource: true,
    })).toBe("commit");
  });
});
