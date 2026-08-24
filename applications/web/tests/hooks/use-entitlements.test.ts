import { describe, expect, it } from "vitest";
import { canAddMore } from "../../src/hooks/use-entitlements";

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
