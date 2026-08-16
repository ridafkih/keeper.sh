import { describe, expect, it } from "vitest";
import { buildWriteBackFieldSummary } from "@/features/dashboard/components/write-back-summary";

const SOURCE_NAME = "Personal";

const NO_EXCLUSIONS = {
  excludeEventDescription: false,
  excludeEventLocation: false,
  excludeEventName: false,
};

/*
 * The classifier (packages/calendar/src/core/sync/write-back.ts) resolves a pair that moved on both sides
 * since the last push as { type: "conflict", resolution: "source-wins" } with
 * suppress: false, so the copy is handed straight back to the one-way repair path: the
 * edit the user made on the copy is overwritten and never reaches the original. That is a
 * different case from the adopt window — Keeper.sh has observed the copy, the user's edit
 * is real, and it is destroyed rather than kept — and the dashboard says nothing about it
 * while promising "Editing a copy changes the original event".
 */
describe("what the dashboard says when both calendars changed", () => {
  it("tells the user which side wins when the original changed too", () => {
    const summary = buildWriteBackFieldSummary(NO_EXCLUSIONS, SOURCE_NAME);
    const sentences = [
      summary.adopted,
      summary.conflict,
      summary.hidden ?? "",
      summary.written,
    ].join(" ");

    expect(sentences).toMatch(/if the original .*(also )?chang/i);
  });

  it("says the edit on the copy is replaced rather than written back", () => {
    const summary = buildWriteBackFieldSummary(NO_EXCLUSIONS, SOURCE_NAME);
    const sentences = [
      summary.adopted,
      summary.conflict,
      summary.hidden ?? "",
      summary.written,
    ].join(" ");

    expect(sentences).toMatch(/replac|overwrit|lost/i);
  });
});
