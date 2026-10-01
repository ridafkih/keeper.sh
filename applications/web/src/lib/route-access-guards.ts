import type { OnboardingCookie } from "./onboarding-cookie";

export type RedirectTarget = "/dashboard" | "/login";

export type SubscriptionPlan = "free" | "pro";

export const resolveDashboardRedirect = (
  hasSession: boolean,
): RedirectTarget | null => {
  if (!hasSession) {
    return "/login";
  }

  return null;
};

export const resolveAuthRedirect = (
  hasSession: boolean,
): RedirectTarget | null => {
  if (hasSession) {
    return "/dashboard";
  }

  return null;
};

export const resolveUpgradeRedirect = (
  hasSession: boolean,
  plan: SubscriptionPlan | null,
): RedirectTarget | null => {
  if (!hasSession) {
    return "/login";
  }

  if (plan === "pro") {
    return "/dashboard";
  }

  return null;
};

export const ONBOARDING_PATH = "/onboarding";

const isOnboardingPath = (pathname: string): boolean =>
  (pathname.replace(/\/+$/, "") || "/") === ONBOARDING_PATH;

export const resolveOnboardingRedirect = (
  onboarding: OnboardingCookie | null,
  pathname: string,
): typeof ONBOARDING_PATH | null => {
  if (onboarding !== "pending" || isOnboardingPath(pathname)) {
    return null;
  }

  return ONBOARDING_PATH;
};

export const needsOnboardingLookup = (
  onboarding: OnboardingCookie | null,
  pathname: string,
): boolean => onboarding === null && !isOnboardingPath(pathname);
