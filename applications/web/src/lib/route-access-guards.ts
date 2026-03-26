export type RedirectTarget = "/dashboard" | "/login";

export type SubscriptionPlan = "pro" | "unlimited";

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

  if (plan === "unlimited") {
    return "/dashboard";
  }

  return null;
};
