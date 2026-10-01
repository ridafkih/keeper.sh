import type { OnboardingStatus } from "@keeper.sh/data-schemas";

const ONBOARDING_COOKIE_NAME = "keeper.onboarding";
const ONBOARDING_COOKIE_CLEAR = `${ONBOARDING_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;

// The web guard only needs to know whether to redirect, so skipped and completed both read as done.
const COOKIE_VALUES: Record<OnboardingStatus, "pending" | "done"> = {
  completed: "done",
  pending: "pending",
  skipped: "done",
};

const onboardingCookieFor = (status: OnboardingStatus): string =>
  `${ONBOARDING_COOKIE_NAME}=${COOKIE_VALUES[status]}; Path=/; SameSite=Lax`;

export { ONBOARDING_COOKIE_CLEAR, ONBOARDING_COOKIE_NAME, onboardingCookieFor };
