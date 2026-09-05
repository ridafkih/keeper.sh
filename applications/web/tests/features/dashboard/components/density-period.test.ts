import { describe, expect, it } from "vitest";
import { resolvePeriod } from "../../../../src/features/dashboard/components/density-period";

describe("resolvePeriod", () => {
  it("splits days around today", () => {
    expect(resolvePeriod(-1)).toBe("past");
    expect(resolvePeriod(0)).toBe("today");
    expect(resolvePeriod(1)).toBe("future");
  });
});
