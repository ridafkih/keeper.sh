import useSWR from "swr";
import { authClient } from "@/lib/auth-client";

interface SubscriptionState {
  plan: "free" | "pro";
  interval: "month" | "year" | "week" | "day" | null;
}

async function fetchCustomerState(): Promise<SubscriptionState> {
  const { data } = await authClient.customer.state();

  const activeSubscription = data?.activeSubscriptions?.[0];

  if (!activeSubscription) {
    return { plan: "free", interval: null };
  }

  return {
    plan: "pro",
    interval: activeSubscription.recurringInterval,
  };
}

export function useSubscription() {
  return useSWR("customer-state", fetchCustomerState);
}
