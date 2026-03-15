import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { getCommercialMode } from "@/config/commercial";

export interface SubscriptionState {
  plan: "free" | "pro";
  interval: "month" | "year" | null;
}

interface ActiveSubscription {
  recurringInterval?: "month" | "year" | null;
}

interface CustomerStateResponse {
  activeSubscriptions?: ActiveSubscription[] | null;
}

const SUBSCRIPTION_STATE_CACHE_KEY = "customer-state";

export const resolveSubscriptionState = (
  customerState: CustomerStateResponse,
): SubscriptionState => {
  const [active] = customerState.activeSubscriptions ?? [];

  if (!active) {
    return { plan: "free", interval: null };
  }

  return {
    plan: "pro",
    interval: active.recurringInterval === "year" ? "year" : "month",
  };
};

const fetchSubscriptionState = async (): Promise<SubscriptionState> => {
  const data = await fetcher<CustomerStateResponse>("/api/auth/customer/state");
  return resolveSubscriptionState(data);
};

interface UseSubscriptionOptions {
  enabled?: boolean;
  fallbackData?: SubscriptionState;
}

const resolveSubscriptionCacheKey = (enabled: boolean): string | null => {
  if (!enabled) {
    return null;
  }

  return SUBSCRIPTION_STATE_CACHE_KEY;
};

export function useSubscription(options: UseSubscriptionOptions = {}) {
  const { enabled = getCommercialMode(), fallbackData } = options;
  const cacheKey = resolveSubscriptionCacheKey(enabled);
  const { data, error, isLoading, mutate } = useSWR(
    cacheKey,
    fetchSubscriptionState,
    { fallbackData },
  );
  return { data, error, isLoading, mutate };
}

export async function fetchSubscriptionStateWithApi(
  fetchApi: <T>(path: string, init?: RequestInit) => Promise<T>,
): Promise<SubscriptionState> {
  const data = await fetchApi<CustomerStateResponse>("/api/auth/customer/state");
  return resolveSubscriptionState(data);
}

export { fetchSubscriptionState };
