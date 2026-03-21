import { describe, expect, it } from "bun:test";
import { resolveSyncEnqueuePlan, SyncEnqueuePlanResolutionError } from "./sync-enqueue-plan";

describe("resolveSyncEnqueuePlan", () => {
  it("returns plan when available", async () => {
    const plan = await resolveSyncEnqueuePlan("user-1", () => Promise.resolve("pro"));
    expect(plan).toBe("pro");
  });

  it("throws typed error when plan is missing", () => {
    expect(resolveSyncEnqueuePlan("user-1", () => Promise.resolve(null))).rejects.toBeInstanceOf(
      SyncEnqueuePlanResolutionError,
    );
  });
});
