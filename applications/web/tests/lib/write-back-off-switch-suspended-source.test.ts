import { describe, expect, it } from "vitest";
import { resolveWritableWriteBackMode } from "@keeper.sh/data-schemas";
import { resolveModeSelection } from "@/lib/write-back-answers";
import type { WriteBackMode } from "@/state/destination-ids";

/*
 * The screen reads its own selection from what the API reports, and the API reports the
 * mode the write-back pass would act on rather than the mode the pair stores: a source
 * that lost write access, or one the user paused, comes back as "off" while still storing
 * "edits_and_deletes". Pressing One-way there is the only opt-out the product offers, and
 * it has to reach the server — otherwise the stored mode survives, and deleting a copy
 * destroys the real event the moment the source is writable again.
 */
const reportedMode = (source: {
  capabilities: readonly string[];
  disabled?: boolean;
}): WriteBackMode =>
  resolveWritableWriteBackMode<WriteBackMode>("edits_and_deletes", {
    calendarType: "google",
    capabilities: source.capabilities,
    disabled: source.disabled ?? false,
    writeBackIdentity: "person@example.com",
  });

const pressOneWay = (selectedMode: WriteBackMode, writableSource: boolean) =>
  resolveModeSelection({
    locked: false,
    nextMode: "off",
    selectedMode,
    status: { reason: null, state: "ok" },
    writableSource,
  });

describe("the One-way button on a source whose two-way sync is only suspended", () => {
  it("commits when the source lost write access", () => {
    const selectedMode = reportedMode({ capabilities: ["pull"] });

    expect(selectedMode).toBe("off");
    expect(pressOneWay(selectedMode, false)).toBe("commit");
  });

  it("commits when the source is paused", () => {
    const selectedMode = reportedMode({ capabilities: ["pull", "push"], disabled: true });

    expect(selectedMode).toBe("off");
    expect(pressOneWay(selectedMode, false)).toBe("commit");
  });

  it("commits on a pair that genuinely stores one-way, which costs nothing", () => {
    expect(pressOneWay("off", true)).toBe("commit");
  });

  it("still ignores re-picking an active mode the pair already carries", () => {
    expect(resolveModeSelection({
      locked: false,
      nextMode: "edits",
      selectedMode: "edits",
      status: { reason: null, state: "ok" },
      writableSource: true,
    })).toBe("ignore");
  });
});
