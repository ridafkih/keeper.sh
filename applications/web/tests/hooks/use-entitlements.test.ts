import { describe, expect, it } from "vitest";
import { buildOptimisticProEntitlements, canAddMore, hasConfiguredSync } from "../../src/hooks/use-entitlements";

describe("canAddMore", () => {
  it("does not treat missing entitlements as hitting the limit", () => {
    expect(canAddMore(undefined)).toBe(true);
  });

  it("allows unlimited entitlements", () => {
    expect(canAddMore({ current: 99, limit: null })).toBe(true);
  });

  it("rejects exhausted entitlements", () => {
    expect(canAddMore({ current: 3, limit: 3 })).toBe(false);
  });
});

describe("feed entitlements", () => {
  it("refuses a second feed on the free plan", () => {
    expect(canAddMore({ current: 1, limit: 1 })).toBe(false);
  });

  it("allows a pro user to keep creating feeds", () => {
    expect(canAddMore({ current: 12, limit: null })).toBe(true);
  });

  it("does not dead-end a lapsed pro user who is over the free limit", () => {
    expect(canAddMore({ current: 5, limit: 1 })).toBe(false);
  });
});

describe("hasConfiguredSync", () => {
  const entitlementsWithMappings = (current: number) => ({
    ...buildOptimisticProEntitlements(),
    plan: "free" as const,
    mappings: { current, limit: 3 },
  });

  it("is false until entitlements have loaded", () => {
    expect(hasConfiguredSync(undefined)).toBe(false);
  });

  it("is false for a user with no mapping yet", () => {
    expect(hasConfiguredSync(entitlementsWithMappings(0))).toBe(false);
  });

  it("is true once a source syncs to a destination", () => {
    expect(hasConfiguredSync(entitlementsWithMappings(1))).toBe(true);
  });
});
