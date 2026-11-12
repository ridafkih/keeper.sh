import type { ConnectReturnTo } from "./connect-return";
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

const CONNECT_PATH = "/dashboard/connect";

const isOnboardingPath = (pathname: string): boolean =>
  (pathname.replace(/\/+$/, "") || "/") === ONBOARDING_PATH;

// The wizard sends people to the connect pages, which sit under the guarded layout.
export const isOnboardingConnectPath = (pathname: string, returnTo?: ConnectReturnTo): boolean =>
  returnTo === "onboarding" && pathname.startsWith(CONNECT_PATH);

const isPartOfOnboarding = (pathname: string, returnTo?: ConnectReturnTo): boolean =>
  isOnboardingPath(pathname) || isOnboardingConnectPath(pathname, returnTo);

export const resolveOnboardingRedirect = (
  onboarding: OnboardingCookie | null,
  pathname: string,
  returnTo?: ConnectReturnTo,
): typeof ONBOARDING_PATH | null => {
  if (onboarding !== "pending" || isPartOfOnboarding(pathname, returnTo)) {
    return null;
  }

  return ONBOARDING_PATH;
};

// Only "done" is trusted as stored: a pending cookie may be stale once onboarding finished elsewhere,
// and asking lets the API record a finish whose own write failed.
export const needsOnboardingLookup = (
  onboarding: OnboardingCookie | null,
  pathname: string,
  returnTo?: ConnectReturnTo,
): boolean => onboarding !== "done" && !isPartOfOnboarding(pathname, returnTo);
