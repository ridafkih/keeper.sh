import { describe, expect, it } from "vitest";
import { describeProposal, describeSyncPairs } from "../../../src/features/onboarding/sync-pairs";

const calendars = new Map([
  ["work", { excludeEventName: true, name: "Work" }],
  ["personal", { excludeEventName: true, name: "Personal" }],
  ["feed", { excludeEventName: false, name: "Team feed" }],
]);

describe("describeSyncPairs", () => {
  it("names a two-way sync once, with both calendars", () => {
    expect(describeSyncPairs([
      { destinationCalendarId: "personal", sourceCalendarId: "work" },
      { destinationCalendarId: "work", sourceCalendarId: "personal" },
    ], calendars)).toEqual([{ busyOnly: true, key: "personal:work", label: "Work and Personal", sourceCalendarId: "work" }]);
  });

  it("names a one-way sync by its direction", () => {
    expect(describeSyncPairs([
      { destinationCalendarId: "work", sourceCalendarId: "feed" },
    ], calendars)).toEqual([{ busyOnly: false, key: "feed:work", label: "Team feed to Work", sourceCalendarId: "feed" }]);
  });

  it("calls a one-way sync busy only when its sending calendar hides event names", () => {
    expect(describeSyncPairs([
      { destinationCalendarId: "feed", sourceCalendarId: "work" },
    ], calendars)).toEqual([{ busyOnly: true, key: "feed:work", label: "Work to Team feed", sourceCalendarId: "work" }]);
  });

  it("shows a two-way sync with details when either side shares event names", () => {
    expect(describeSyncPairs([
      { destinationCalendarId: "work", sourceCalendarId: "feed" },
      { destinationCalendarId: "feed", sourceCalendarId: "work" },
    ], calendars)).toMatchObject([{ busyOnly: false, label: "Team feed and Work" }]);
  });

  it("skips mappings whose calendars are not loaded", () => {
    expect(describeSyncPairs([
      { destinationCalendarId: "gone", sourceCalendarId: "work" },
    ], calendars)).toEqual([]);
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
