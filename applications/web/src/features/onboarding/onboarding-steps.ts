export const ONBOARDING_STEPS = ["welcome", "connect", "sync", "done"] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const ONBOARDING_STEP_LABELS: Record<OnboardingStep, string> = {
  connect: "Connect",
  done: "Done",
  sync: "First Sync",
  welcome: "Welcome",
};

export interface OnboardingSearch {
  step?: OnboardingStep;
  accountId?: string;
  syncId?: string;
  error?: string;
}

const isOnboardingStep = (value: unknown): value is OnboardingStep =>
  typeof value === "string" && ONBOARDING_STEPS.some((step) => step === value);

const readText = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

export const readOnboardingSearch = (search: Record<string, unknown>): OnboardingSearch => ({
  accountId: readText(search.accountId),
  error: readText(search.error),
  step: isOnboardingStep(search.step) ? search.step : undefined,
  syncId: readText(search.syncId),
});

const BACK_STEPS: Partial<Record<OnboardingStep, OnboardingStep>> = {
  connect: "welcome",
  sync: "connect",
};

export const previousOnboardingStep = (step: OnboardingStep): OnboardingStep | null => BACK_STEPS[step] ?? null;

// Done is reached by starting a sync, so it can't be skipped past or stepped back from.
export const canSkipOnboardingAt = (step: OnboardingStep): boolean => step !== "done";
