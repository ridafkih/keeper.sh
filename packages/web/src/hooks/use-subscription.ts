import useSWR, { type SWRResponse } from "swr";
import { authClient } from "@/lib/auth-client";
import { isCommercialMode } from "@/config/mode";

interface SubscriptionState {
  plan: "free" | "pro";
  interval: "month" | "year" | "week" | "day" | null;
}

const fetchCustomerState = async (): Promise<SubscriptionState> => {
  if (!isCommercialMode) {
    return { interval: null, plan: "pro" };
  }

  const { data } = await authClient.customer.state();

  const [activeSubscription] = data?.activeSubscriptions ?? [];

  if (!activeSubscription) {
    return { interval: null, plan: "free" };
  }

  return {
    interval: activeSubscription.recurringInterval,
    plan: "pro",
  };
};

export const useSubscription = (): SWRResponse<SubscriptionState> =>
  useSWR("customer-state", fetchCustomerState);
