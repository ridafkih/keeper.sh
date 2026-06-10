import { describe, expect, it } from "vitest";
import { filterSourcesByPlan, filterUserIdsByPlan } from "../../src/utils/source-plan-selection";

type Plan = "free" | "pro";

interface SourceRecord {
  id: string;
  userId: string;
  calendarType: string;
}

describe("filterSourcesByPlan", () => {
  it("filters sources by target plan and preserves source order", async () => {
    const lookupCalls: string[] = [];

    const sources: SourceRecord[] = [
      { calendarType: "ical", id: "s-1", userId: "u-pro" },
      { calendarType: "ical", id: "s-2", userId: "u-free" },
      { calendarType: "google", id: "s-3", userId: "u-pro" },
      { calendarType: "ical", id: "s-4", userId: "u-other-pro" },
    ];

    const filtered = await filterSourcesByPlan(sources, "pro", (userId) => {
      lookupCalls.push(userId);
      const planByUser: Record<string, Plan> = {
        "u-free": "free",
        "u-other-pro": "pro",
        "u-pro": "pro",
      };

      const plan = planByUser[userId];
      if (!plan) {
        throw new Error(`Missing test plan for ${userId}`);
      }

      return Promise.resolve(plan);
    });

    expect(filtered.map((source) => source.id)).toEqual(["s-1", "s-3", "s-4"]);
    expect(lookupCalls).toEqual(["u-pro", "u-free", "u-other-pro"]);
  });

  it("propagates lookup failures", () => {
    expect(
      filterSourcesByPlan(
        [{ calendarType: "ical", id: "s-1", userId: "u-1" }],
        "pro",
        () => Promise.reject(new Error("plan service unavailable")),
      ),
    ).rejects.toThrow("plan service unavailable");
  });
});

describe("filterUserIdsByPlan", () => {
  it("deduplicates user IDs before plan lookups", async () => {
    const lookupCalls: string[] = [];

    const userIds = ["u-pro", "u-free", "u-pro", "u-other-pro", "u-other-pro"];

    const filteredUserIds = await filterUserIdsByPlan(userIds, "pro", (userId) => {
      lookupCalls.push(userId);
      const planByUser: Record<string, Plan> = {
        "u-free": "free",
        "u-other-pro": "pro",
        "u-pro": "pro",
      };

      const plan = planByUser[userId];
      if (!plan) {
        throw new Error(`Missing test plan for ${userId}`);
      }

      return Promise.resolve(plan);
    });

    expect(filteredUserIds).toEqual(["u-pro", "u-other-pro"]);
    expect(lookupCalls).toEqual(["u-pro", "u-free", "u-other-pro"]);
  });
});
