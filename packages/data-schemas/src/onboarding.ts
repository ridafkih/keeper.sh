import { type } from "arktype";

const ONBOARDING_STATUSES = ["pending", "completed", "skipped"] as const;

const onboardingStatusSchema = type.enumerated(...ONBOARDING_STATUSES);
type OnboardingStatus = typeof onboardingStatusSchema.infer;

const onboardingUpdateBodySchema = type({
  status: "'completed' | 'skipped'",
  "+": "reject",
});
type OnboardingUpdateBody = typeof onboardingUpdateBodySchema.infer;

export { ONBOARDING_STATUSES, onboardingStatusSchema, onboardingUpdateBodySchema };
export type { OnboardingStatus, OnboardingUpdateBody };
