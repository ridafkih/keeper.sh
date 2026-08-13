import type { SubscriptionState } from "@/hooks/use-subscription";

export type UpgradeMode = "upgrade" | "manage" | "switch-interval";

export const resolveUpgradeMode = (
  subscription: SubscriptionState | undefined,
  yearlySelected: boolean,
): UpgradeMode => {
  if (subscription?.plan !== "pro") {
    return "upgrade";
  }

  if (subscription.interval === null) {
    return "manage";
  }

  return subscription.interval === (yearlySelected ? "year" : "month")
    ? "manage"
    : "switch-interval";
};
