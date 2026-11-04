import { describe, expect, it } from "vitest";
import { planSyncStart } from "../../../src/features/onboarding/start-sync";

const origin = { accountId: "google", capabilities: ["pull", "push"], id: "work", name: "Work" };
const destination = { accountId: "icloud", capabilities: ["pull", "push"], id: "personal", name: "Personal" };
const proposal = { backward: true, destination, forward: true, origin };

describe("planSyncStart", () => {
  it("maps both directions and keeps busy only by default", () => {
    expect(planSyncStart(proposal, { backward: true, busyOnly: true, forward: true })).toEqual({
      mappings: [
        { destinationCalendarId: "personal", sourceCalendarId: "work" },
        { destinationCalendarId: "work", sourceCalendarId: "personal" },
      ],
      titledSourceIds: [],
    });
  });

  it("maps only the directions left on", () => {
    expect(planSyncStart(proposal, { backward: false, busyOnly: true, forward: true }).mappings)
      .toEqual([{ destinationCalendarId: "personal", sourceCalendarId: "work" }]);
  });

  it("copies titles from every mapped source when busy only is off", () => {
    expect(planSyncStart(proposal, { backward: false, busyOnly: false, forward: true }).titledSourceIds)
      .toEqual(["work"]);
  });

  it("never maps a direction the proposal ruled out", () => {
    expect(planSyncStart({ ...proposal, backward: false }, { backward: true, busyOnly: true, forward: false }).mappings)
      .toEqual([]);
  });
});
