import { describe, expect, it } from "vitest";
import {
  READ_ONLY_SOURCE_COPY,
  resolveUnwritableSourceCopy,
  supportsWriteBack,
  UNWRITABLE_SOURCE_COPY,
} from "@/lib/write-back-copy";

/*
 * A calendar shared with the user read-only carries "pull" alone. The dashboard enabled
 * both two-way controls on it, took the deletion consent, and promised that editing the
 * copy changes the original — for a calendar the account can never write to.
 */
describe("a source calendar the account may only read", () => {
  it("is not offered two-way sync", () => {
    expect(supportsWriteBack({ calendarType: "google", capabilities: ["pull"] }))
      .toBe(false);
    expect(supportsWriteBack({ calendarType: "outlook", capabilities: ["pull"] }))
      .toBe(false);
  });

  it("still offers it on a calendar the account may write", () => {
    expect(supportsWriteBack({ calendarType: "google", capabilities: ["pull", "push"] }))
      .toBe(true);
  });

  it("is not described as a calendar the user subscribed to by link", () => {
    expect(resolveUnwritableSourceCopy({
      calendarType: "google",
      capabilities: ["pull"],
    })).toBe(READ_ONLY_SOURCE_COPY);
    expect(resolveUnwritableSourceCopy({
      calendarType: "ical",
      capabilities: ["pull"],
    })).toBe(UNWRITABLE_SOURCE_COPY);
  });
});
