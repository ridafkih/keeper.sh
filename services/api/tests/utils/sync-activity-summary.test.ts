import { describe, expect, it } from "vitest";
import type { SyncRunRecord } from "@keeper.sh/data-schemas";

import { summarizeSyncRuns } from "@/utils/syncs";

const run = (destinationCalendarId: string, overrides: Partial<SyncRunRecord> = {}): SyncRunRecord => ({
  added: 0,
  copied: 0,
  destinationCalendarId,
  failed: 0,
  removed: 0,
  sharedDestination: false,
  skipped: 0,
  skippedBy: [],
  ...overrides,
});

const SINCE = new Date("2026-09-22T00:00:00.000Z");
const RECENT = new Date("2026-09-29T09:00:00.000Z");
const EARLIER = new Date("2026-09-28T09:00:00.000Z");
const STALE = new Date("2026-09-10T09:00:00.000Z");

describe("summarizeSyncRuns", () => {
  it("adds up copies made and removed inside the window only", () => {
    const summary = summarizeSyncRuns([
      { createdAt: RECENT, run: run("work", { added: 3, removed: 1 }) },
      { createdAt: EARLIER, run: run("family", { added: 33 }) },
      { createdAt: STALE, run: run("work", { added: 40, removed: 5 }) },
    ], SINCE);

    expect(summary.added).toBe(36);
    expect(summary.removed).toBe(1);
  });

  it("takes what is skipped from each destination's latest run, merging reasons across destinations", () => {
    const summary = summarizeSyncRuns([
      { createdAt: RECENT, run: run("work", { skipped: 5, skippedBy: [{ count: 4, name: "Focus Time", ruleId: "focus" }] }) },
      { createdAt: EARLIER, run: run("work", { skipped: 50, skippedBy: [{ count: 50, name: "Focus Time", ruleId: "focus" }] }) },
      { createdAt: STALE, run: run("family", {
        skipped: 7,
        skippedBy: [{ count: 2, name: "Focus Time", ruleId: "focus" }, { count: 5, name: "Out of Office", ruleId: "ooo" }],
      }) },
    ], SINCE);

    expect(summary.skipped).toBe(12);
    expect(summary.skippedBy).toEqual([
      { count: 6, name: "Focus Time", ruleId: "focus" },
      { count: 5, name: "Out of Office", ruleId: "ooo" },
    ]);
  });

  it("reports nothing for a sync with no runs", () => {
    expect(summarizeSyncRuns([], SINCE)).toEqual({ added: 0, removed: 0, skipped: 0, skippedBy: [] });
  });
});
