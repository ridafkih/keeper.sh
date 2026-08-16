import { describe, expect, it } from "vitest";
import { resolveUnwritableSourceCopy, supportsWriteBack } from "@/lib/write-back-copy";

/*
 * Pausing a calendar is the documented way to make Keeper.sh stop touching it, and the API
 * both refuses two-way on a paused source and reports the pair as one-way. Offering the
 * mode here walks the user through the deletion-consent modal for a setting the screen
 * then denies, with nothing on the screen saying why.
 */
const PAUSED_SOURCE = {
  calendarType: "google",
  capabilities: ["pull", "push"],
  paused: true,
  writeBackIdentity: "person@example.com",
};

const ACTIVE_SOURCE = { ...PAUSED_SOURCE, paused: false };

describe("a paused source calendar", () => {
  it("is not offered two-way sync", () => {
    expect(supportsWriteBack(PAUSED_SOURCE)).toBe(false);
  });

  it("is explained as paused rather than as read-only", () => {
    const copy = resolveUnwritableSourceCopy(PAUSED_SOURCE);

    expect(copy).toContain("paused");
    expect(copy).not.toBe(resolveUnwritableSourceCopy({ ...PAUSED_SOURCE, paused: false }));
  });

  it("still offers two-way sync once it is not paused", () => {
    expect(supportsWriteBack(ACTIVE_SOURCE)).toBe(true);
  });
});
