import { type } from "arktype";

const ONBOARDING_STATUSES = ["pending", "completed", "skipped"] as const;

const onboardingStatusSchema = type.enumerated(...ONBOARDING_STATUSES);
type OnboardingStatus = typeof onboardingStatusSchema.infer;

const onboardingUpdateBodySchema = type({
  status: "'completed' | 'skipped'",
  "+": "reject",
});
type OnboardingUpdateBody = typeof onboardingUpdateBodySchema.infer;

const ONBOARDING_COOKIE_NAME = "keeper.onboarding";

type OnboardingCookie = "pending" | "done";

// The web guard only needs to know whether to redirect, so skipped and completed both read as done.
const toOnboardingCookie = (status: OnboardingStatus): OnboardingCookie => {
  if (status === "pending") return "pending";
  return "done";
};

export { ONBOARDING_COOKIE_NAME, ONBOARDING_STATUSES, onboardingStatusSchema, onboardingUpdateBodySchema, toOnboardingCookie };
export type { OnboardingCookie, OnboardingStatus, OnboardingUpdateBody };
