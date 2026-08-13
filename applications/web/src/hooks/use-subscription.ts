import useSWR from "swr";
import { fetcher, HttpError } from "@/lib/fetcher";
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

interface EntitlementsPlanResponse {
  plan: "free" | "pro";
}

const SUBSCRIPTION_STATE_CACHE_KEY = "customer-state";
const CUSTOMER_STATE_PATH = "/api/auth/customer/state";
const ENTITLEMENTS_PATH = "/api/entitlements";

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

const isUnauthorized = (error: unknown): boolean =>
  error instanceof HttpError && error.status === 401;

const fetchSubscriptionState = (): Promise<SubscriptionState> =>
  fetchSubscriptionStateWithApi((path) => fetcher(path));

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
  try {
    const data = await fetchApi<CustomerStateResponse>(CUSTOMER_STATE_PATH);
    return resolveSubscriptionState(data);
  } catch (error) {
    if (isUnauthorized(error)) {
      throw error;
    }

    const entitlements = await fetchApi<EntitlementsPlanResponse>(ENTITLEMENTS_PATH);
    return { plan: entitlements.plan, interval: null };
  }
}

export { fetchSubscriptionState };
