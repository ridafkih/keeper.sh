import { describe, expect, it } from "vitest";
import { resolveUpgradeMode } from "../../src/lib/upgrade-mode";

describe("resolveUpgradeMode", () => {
  it("offers the upgrade when the subscription has not loaded", () => {
    expect(resolveUpgradeMode(undefined, false)).toBe("upgrade");
  });

  it("offers the upgrade to a free user", () => {
    expect(resolveUpgradeMode({ plan: "free", interval: null }, false)).toBe("upgrade");
  });

  it("manages a subscription whose interval matches the selected one", () => {
    expect(resolveUpgradeMode({ plan: "pro", interval: "year" }, true)).toBe("manage");
    expect(resolveUpgradeMode({ plan: "pro", interval: "month" }, false)).toBe("manage");
  });

  it("offers an interval switch only when the intervals genuinely differ", () => {
    expect(resolveUpgradeMode({ plan: "pro", interval: "year" }, false)).toBe("switch-interval");
    expect(resolveUpgradeMode({ plan: "pro", interval: "month" }, true)).toBe("switch-interval");
  });

  it("does not claim a mismatch when the interval is unknown", () => {
    expect(resolveUpgradeMode({ plan: "pro", interval: null }, true)).toBe("manage");
    expect(resolveUpgradeMode({ plan: "pro", interval: null }, false)).toBe("manage");
  });
});
