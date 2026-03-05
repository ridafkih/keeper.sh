import useSWR, { type SWRResponse } from "swr";
import { authClient } from "../lib/auth-client";

export interface SubscriptionState {
  plan: "free" | "pro";
  interval: "month" | "year" | null;
}

async function fetchSubscriptionState(): Promise<SubscriptionState> {
  const { data } = await authClient.customer.state();
  const [active] = data?.activeSubscriptions ?? [];

  if (!active) return { plan: "free", interval: null };

  return {
    plan: "pro",
    interval: active.recurringInterval === "year" ? "year" : "month",
  };
}

export function useSubscription(): SWRResponse<SubscriptionState> {
  return useSWR("customer-state", fetchSubscriptionState);
}
