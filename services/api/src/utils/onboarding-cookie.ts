import { ONBOARDING_COOKIE_NAME, toOnboardingCookie } from "@keeper.sh/data-schemas";
import type { OnboardingStatus } from "@keeper.sh/data-schemas";

const ONBOARDING_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const ONBOARDING_COOKIE_CLEAR = `${ONBOARDING_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;

const onboardingCookieFor = (status: OnboardingStatus): string =>
  `${ONBOARDING_COOKIE_NAME}=${toOnboardingCookie(status)}; Path=/; Max-Age=${ONBOARDING_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;

export { ONBOARDING_COOKIE_CLEAR, onboardingCookieFor };
