import { describe, expect, it } from "vitest";
import { isPlanShownOnHome } from "../../../../src/features/dashboard/components/plan-placement";

describe("isPlanShownOnHome", () => {
  it("keeps the upgrade offer off home until a sync is configured", () => {
    expect(isPlanShownOnHome({ isPro: false, hasConfiguredSync: false })).toBe(false);
  });

  it("promotes the upgrade offer on home once a sync is configured", () => {
    expect(isPlanShownOnHome({ isPro: false, hasConfiguredSync: true })).toBe(true);
  });

  it("always shows plan management to a pro user", () => {
    expect(isPlanShownOnHome({ isPro: true, hasConfiguredSync: false })).toBe(true);
  });
});
