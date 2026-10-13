import { describe, expect, it } from "vitest";
import { canFormSync, resolveSetupSteps } from "../../../src/features/setup/setup-card-steps";
import { makeSource } from "./fixtures";

const steps = (overrides: Partial<Parameters<typeof resolveSetupSteps>[0]>) =>
  resolveSetupSteps({ pairable: false, sourceCount: 0, syncCount: 0, usesFeeds: false, ...overrides });

describe("resolveSetupSteps", () => {
  it("shows every step undone for a brand-new user", () => {
    const result = steps({});
    expect(result.show).toBe(true);
    expect(result.steps.map((step) => step.done)).toEqual([false, false, false]);
  });

  it("marks progress as calendars arrive", () => {
    expect(steps({ sourceCount: 1 }).steps.map((step) => step.done)).toEqual([true, false, false]);
    expect(steps({ pairable: true, sourceCount: 2 }).steps.map((step) => step.done)).toEqual([true, true, false]);
  });

  it("hides once the first sync exists", () => {
    expect(steps({ pairable: true, sourceCount: 2, syncCount: 1 }).show).toBe(false);
  });

  it("stays out of the way of someone who only combines calendars into iCal feeds", () => {
    expect(steps({ sourceCount: 3, usesFeeds: true }).show).toBe(false);
  });
});

describe("canFormSync", () => {
  it("counts two calendars from one account", () => {
    expect(canFormSync([makeSource("work", "google"), makeSource("personal", "google")])).toBe(true);
  });

  it("needs one calendar to read from and another to write to", () => {
    expect(canFormSync([makeSource("work", "google")])).toBe(false);
    expect(canFormSync([makeSource("a", "ics", ["pull"]), makeSource("b", "ics", ["pull"])])).toBe(false);
    expect(canFormSync([makeSource("a", "ics", ["pull"]), makeSource("b", "google", ["push"])])).toBe(true);
  });
});
