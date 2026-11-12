import { describe, expect, it } from "vitest";
import { updatesRequestUserSync } from "../../src/utils/source-sync-requests";

describe("source updates that request a user sync", () => {
  it("requests a sync when reminders on copies are turned off", () => {
    expect(updatesRequestUserSync({ disableEventReminders: true })).toBe(true);
  });

  it("requests a sync when reminders on copies are turned back on", () => {
    expect(updatesRequestUserSync({ disableEventReminders: false })).toBe(true);
  });

  it("requests a sync when copies are marked private", () => {
    expect(updatesRequestUserSync({ disableEventReminders: true })).toBe(true);
  });

  it("does not request a sync for a rename", () => {
    expect(updatesRequestUserSync({ name: "Work" })).toBe(false);
  });
});
