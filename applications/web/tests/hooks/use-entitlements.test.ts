import { describe, expect, it } from "bun:test";
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
