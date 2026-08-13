import { useState } from "react";
import { type } from "arktype";
import useSWR from "swr";
import { planSchema } from "@keeper.sh/data-schemas";
import { fetcher, HttpError } from "@/lib/fetcher";
import { getCommercialMode } from "@/config/commercial";
import { retainKnownInterval } from "@/lib/upgrade-mode";

export interface SubscriptionState {
  plan: "free" | "pro";
  interval: "month" | "year" | null;
}

const customerStateSchema = type({
  activeSubscriptions: type({
    "recurringInterval?": "'month' | 'year' | null",
  })
    .array()
    .or("null"),
});

const entitlementsPlanSchema = type({ plan: planSchema });

type CustomerStateResponse = typeof customerStateSchema.infer;

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

  const { recurringInterval } = active;

  return {
    plan: "pro",
    interval:
      recurringInterval === "year" || recurringInterval === "month"
        ? recurringInterval
        : null,
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

  const [lastKnown, setLastKnown] = useState(fallbackData);
  const subscription = retainKnownInterval(lastKnown, data);

  if (
    subscription?.plan !== lastKnown?.plan ||
    subscription?.interval !== lastKnown?.interval
  ) {
    setLastKnown(subscription);
  }

  return { data: subscription, error, isLoading, mutate };
}

export async function fetchSubscriptionStateWithApi(
  fetchApi: <T>(path: string, init?: RequestInit) => Promise<T>,
): Promise<SubscriptionState> {
  try {
    const data = await fetchApi<unknown>(CUSTOMER_STATE_PATH);
    return resolveSubscriptionState(customerStateSchema.assert(data));
  } catch (error) {
    if (isUnauthorized(error)) {
      throw error;
    }

    console.error(
      `[subscription] ${CUSTOMER_STATE_PATH} read failed, falling back to ${ENTITLEMENTS_PATH}:`,
      error,
    );

    const entitlements = entitlementsPlanSchema.assert(
      await fetchApi<unknown>(ENTITLEMENTS_PATH),
    );
    return { plan: entitlements.plan, interval: null };
  }
}

export { fetchSubscriptionState };
