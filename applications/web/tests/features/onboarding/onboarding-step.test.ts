import { describe, expect, it } from "vitest";
import { resolveOnboardingStep } from "../../../src/features/onboarding/onboarding-step";
import type { OnboardingStepInput } from "../../../src/features/onboarding/onboarding-step";

const settled = { failingCount: 0, pendingCount: 0, seq: 8 };

const input = (overrides: Partial<OnboardingStepInput> = {}): OnboardingStepInput => ({
  copiedCount: null,
  hasCalendars: true,
  hasConfiguredSync: false,
  hasProposal: false,
  mappingSync: settled,
  run: { phase: "idle" },
  syncing: false,
  ...overrides,
});

describe("resolveOnboardingStep before syncing starts", () => {
  it("welcomes a user with no calendars", () => {
    expect(resolveOnboardingStep(input({ hasCalendars: false }))).toBe("welcome");
  });

  it("asks where busy time should show while there is one calendar", () => {
    expect(resolveOnboardingStep(input())).toBe("add-destination");
  });

  it("proposes the sync once a second calendar can take copies", () => {
    expect(resolveOnboardingStep(input({ hasProposal: true }))).toBe("ready");
  });

  it("goes straight home for someone who already syncs", () => {
    expect(resolveOnboardingStep(input({ hasConfiguredSync: true, hasProposal: true }))).toBe("home");
  });
});

describe("resolveOnboardingStep after Start syncing", () => {
  const started = { phase: "started", startedAfterSeq: 8 } as const;

  it("keeps copying until the server reports state newer than the start", () => {
    expect(resolveOnboardingStep(input({ copiedCount: 0, run: started }))).toBe("copying");
  });

  it("keeps copying while the new mapping has not finished its first sync", () => {
    expect(resolveOnboardingStep(input({
      copiedCount: 3,
      mappingSync: { failingCount: 0, pendingCount: 1, seq: 9 },
      run: started,
    }))).toBe("copying");
  });

  it("keeps copying while a sync is running", () => {
    expect(resolveOnboardingStep(input({
      copiedCount: 3,
      mappingSync: { ...settled, seq: 9 },
      run: started,
      syncing: true,
    }))).toBe("copying");
  });

  it("keeps copying until the copied count is known", () => {
    expect(resolveOnboardingStep(input({ mappingSync: { ...settled, seq: 9 }, run: started })))
      .toBe("copying");
  });

  it("shows the events copied once the first sync settles with copies", () => {
    expect(resolveOnboardingStep(input({
      copiedCount: 24,
      mappingSync: { ...settled, seq: 9 },
      run: started,
    }))).toBe("copied");
  });

  it("says there is nothing to copy yet when the first sync settles empty", () => {
    expect(resolveOnboardingStep(input({
      copiedCount: 0,
      mappingSync: { ...settled, seq: 9 },
      run: started,
    }))).toBe("nothing-to-copy");
  });

  it("hands a failing first sync to home, where its status shows", () => {
    expect(resolveOnboardingStep(input({
      mappingSync: { failingCount: 1, pendingCount: 0, seq: 9 },
      run: started,
    }))).toBe("home");
  });

  it("goes home once the user finishes", () => {
    expect(resolveOnboardingStep(input({ hasConfiguredSync: true, run: { phase: "finished" } })))
      .toBe("home");
  });
});
