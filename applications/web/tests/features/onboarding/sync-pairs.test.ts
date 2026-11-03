import { describe, expect, it } from "vitest";
import { describeProposal, describeSyncPairs } from "../../../src/features/onboarding/sync-pairs";

const names = new Map([["work", "Work"], ["personal", "Personal"], ["feed", "Team feed"]]);

describe("describeSyncPairs", () => {
  it("names a two-way sync once, with both calendars", () => {
    expect(describeSyncPairs([
      { destinationCalendarId: "personal", sourceCalendarId: "work" },
      { destinationCalendarId: "work", sourceCalendarId: "personal" },
    ], names)).toEqual([{ key: "personal:work", label: "Work and Personal", sourceCalendarId: "work" }]);
  });

  it("names a one-way sync by its direction", () => {
    expect(describeSyncPairs([
      { destinationCalendarId: "work", sourceCalendarId: "feed" },
    ], names)).toEqual([{ key: "feed:work", label: "Team feed to Work", sourceCalendarId: "feed" }]);
  });

  it("skips mappings whose calendars are not loaded", () => {
    expect(describeSyncPairs([
      { destinationCalendarId: "gone", sourceCalendarId: "work" },
    ], names)).toEqual([]);
  });
});

describe("describeProposal", () => {
  const origin = { name: "Work" };
  const destination = { name: "Personal" };

  it("says both calendars show each other's events as busy", () => {
    expect(describeProposal({ backward: true, destination, forward: true, origin }))
      .toBe("Work and Personal will each show you as busy whenever the other has an event.");
  });

  it("says which calendar shows the other's events as busy", () => {
    expect(describeProposal({ backward: false, destination, forward: true, origin }))
      .toBe("Personal will show you as busy whenever Work has an event.");
    expect(describeProposal({ backward: true, destination, forward: false, origin }))
      .toBe("Work will show you as busy whenever Personal has an event.");
  });
});
