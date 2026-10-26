import { describe, expect, it } from "vitest";

import { summarizePairSkips } from "@/utils/syncs";

describe("summarizePairSkips", () => {
  it("adds up what the sync's pairs skip now, merging reasons by rule", () => {
    const summary = summarizePairSkips([
      { skippedBy: [{ count: 4, name: "Focus time", ruleId: "skip:focus_time" }], skippedCount: 5 },
      {
        skippedBy: [
          { count: 2, name: "Focus time", ruleId: "skip:focus_time" },
          { count: 5, name: "Out of office", ruleId: "skip:out_of_office" },
        ],
        skippedCount: 7,
      },
    ]);

    expect(summary).toEqual({
      skipped: 12,
      skippedBy: [
        { count: 6, name: "Focus time", ruleId: "skip:focus_time" },
        { count: 5, name: "Out of office", ruleId: "skip:out_of_office" },
      ],
    });
  });

  it("keeps the total and the reasons from the same pairs, so the reasons never outgrow it", () => {
    const summary = summarizePairSkips([
      { skippedBy: [{ count: 3, name: "All-day events", ruleId: "skip:all_day" }], skippedCount: 3 },
    ]);

    const named = summary.skippedBy.reduce((total, reason) => total + reason.count, 0);
    expect(named).toBeLessThanOrEqual(summary.skipped);
  });

  it("reports nothing for a sync with no pairs", () => {
    expect(summarizePairSkips([])).toEqual({ skipped: 0, skippedBy: [] });
  });
});
