import { describe, expect, it } from "vitest";
import { buildOptimisticProEntitlements } from "../../src/hooks/use-entitlements";

describe("buildOptimisticProEntitlements", () => {
  it("never claims realtime sync before the server confirms it", () => {
    expect(buildOptimisticProEntitlements().realtimeSync).toBe(false);
  });

  it("keeps optimistically enabling the plan-only entitlements", () => {
    const optimistic = buildOptimisticProEntitlements();

    expect(optimistic.canCustomizeIcalFeed).toBe(true);
    expect(optimistic.canUseEventFilters).toBe(true);
    expect(optimistic.plan).toBe("pro");
  });
});
