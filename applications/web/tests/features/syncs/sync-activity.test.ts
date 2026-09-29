import { describe, expect, it } from "vitest";
import type { SyncActivityEntry, SyncRunRecord } from "@keeper.sh/data-schemas";
import { describeActivitySummary, formatActivityDay, groupActivity } from "../../../src/features/syncs/sync-activity";

const run = (id: string, createdAt: string, destinationCalendarId: string, overrides: Partial<SyncRunRecord> = {}): SyncActivityEntry => ({
  createdAt,
  id,
  kind: "run",
  run: { added: 0, copied: 0, destinationCalendarId, failed: 0, removed: 0, sharedDestination: false, skipped: 0, skippedBy: [], ...overrides },
});

const change = (id: string, createdAt: string): SyncActivityEntry => ({ change: { kind: "resumed" }, createdAt, id, kind: "change" });

const local = (day: number, hours: number, minutes: number): string => new Date(2026, 8, day, hours, minutes).toISOString();

const ENTRIES: SyncActivityEntry[] = [
  run("r1", local(29, 9, 38), "work", { added: 2 }),
  run("r2", local(29, 9, 37), "family", { failed: 4 }),
  change("c1", local(29, 9, 12)),
  run("r3", local(29, 8, 2), "work", { removed: 1 }),
  run("r4", local(28, 18, 21), "family", { added: 33 }),
];

describe("groupActivity", () => {
  it("splits by day and folds runs a moment apart into one pass", () => {
    const days = groupActivity(ENTRIES, { calendarId: null, kind: "all" });

    expect(days.map((day) => day.items.map((item) => item.kind))).toEqual([["pass", "change", "pass"], ["pass"]]);
    expect(days[0]?.items[0]).toMatchObject({ id: "r1", runs: [{ destinationCalendarId: "work" }, { destinationCalendarId: "family" }] });
    expect(days[0]).toMatchObject({ added: 2, removed: 1 });
  });

  it("starts a new pass when a calendar would appear twice in one", () => {
    const days = groupActivity([
      run("a", local(29, 9, 38), "work", { added: 1 }),
      run("b", local(29, 9, 37), "work", { added: 1 }),
    ], { calendarId: null, kind: "all" });

    expect(days[0]?.items).toHaveLength(2);
  });

  it("narrows to runs, to one calendar, or to your changes", () => {
    const runsOnly = groupActivity(ENTRIES, { calendarId: null, kind: "runs" });
    const family = groupActivity(ENTRIES, { calendarId: "family", kind: "all" });
    const changes = groupActivity(ENTRIES, { calendarId: "family", kind: "changes" });

    expect(runsOnly.flatMap((day) => day.items).some((item) => item.kind === "change")).toBe(false);
    expect(family.flatMap((day) => day.items).map((item) => item.id)).toEqual(["r2", "c1", "r4"]);
    expect(changes.flatMap((day) => day.items).map((item) => item.id)).toEqual(["c1"]);
  });
});

describe("formatActivityDay", () => {
  it("names today and yesterday", () => {
    const now = new Date(2026, 8, 29, 12).getTime();
    expect(formatActivityDay(new Date(2026, 8, 29), now)).toBe("Today");
    expect(formatActivityDay(new Date(2026, 8, 28), now)).toBe("Yesterday");
  });
});

describe("describeActivitySummary", () => {
  it("reads the week, what is skipped and what is waiting", () => {
    const sentence = describeActivitySummary(
      { added: 142, removed: 25, skipped: 21, skippedBy: [{ count: 9, name: "Focus time", ruleId: "focus" }] },
      ["Work", "Personal", "Family"],
      ["Family"],
    );

    expect(sentence.period).toBe("In the last 7 days,");
    expect(sentence.headline).toBe("copied 142 events and removed 25 copies across Work, Personal and Family.");
    expect(sentence.detail).toBe("Skipping 21 events, mostly focus time. Family is waiting on a reconnect.");
  });

  it("says so when nothing moved", () => {
    const sentence = describeActivitySummary({ added: 0, removed: 0, skipped: 0, skippedBy: [] }, ["Work"], []);
    expect(sentence.headline).toBe("nothing needed copying.");
    expect(sentence.detail).toBe("");
  });
});
