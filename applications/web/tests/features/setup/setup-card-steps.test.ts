import { describe, expect, it } from "vitest";
import { resolveSetupSteps } from "../../../src/features/setup/setup-card-steps";

describe("resolveSetupSteps", () => {
  it("shows every step undone for a brand-new user", () => {
    const result = resolveSetupSteps({ accountCount: 0, syncCount: 0, sourceCount: 0 });
    expect(result.show).toBe(true);
    expect(result.steps.map((step) => step.done)).toEqual([false, false, false]);
  });

  it("marks progress as calendars arrive", () => {
    const result = resolveSetupSteps({ accountCount: 2, syncCount: 0, sourceCount: 3 });
    expect(result.steps.map((step) => step.done)).toEqual([true, true, false]);
  });

  it("hides once the first sync exists", () => {
    expect(resolveSetupSteps({ accountCount: 2, syncCount: 1, sourceCount: 2 }).show).toBe(false);
  });
});
