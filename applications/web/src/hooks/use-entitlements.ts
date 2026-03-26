import { useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";
import { fetcher } from "@/lib/fetcher";
import { useSubscription } from "./use-subscription";

interface EntitlementLimit {
  current: number;
  limit: number | null;
}

interface EntitlementTrial {
  endsAt: string;
}

interface Entitlements {
  plan: "pro" | "unlimited" | null;
  trial: EntitlementTrial | null;
  accounts: EntitlementLimit;
  mappings: EntitlementLimit;
  canCustomizeIcalFeed: boolean;
  canUseEventFilters: boolean;
}

const USAGE_CACHE_KEY = "/api/entitlements";

function useEntitlements() {
  const { data: subscription } = useSubscription();
  const {
    data: serverEntitlements,
    mutate,
    isLoading,
    error,
  } = useSWR<Entitlements>(USAGE_CACHE_KEY, fetcher);

  const data = () => {
    if (serverEntitlements) {
      return serverEntitlements;
    }

    if (!subscription?.plan) {
      return undefined;
    }

    return {
      plan: subscription.plan,
      trial: null,
      accounts: { current: 0, limit: null },
      mappings: { current: 0, limit: null },
      canCustomizeIcalFeed: true,
      canUseEventFilters: true,
    };
  };

  return { data, mutate, isLoading, error };
}

function useMutateEntitlements() {
  const { mutate } = useSWRConfig();

  const adjustMappingCount = useCallback(
    (delta: number) => {
      mutate<Entitlements>(
        USAGE_CACHE_KEY,
        (current) => {
          if (!current) return current;

          const nextCount = Math.max(0, current.mappings.current + delta);
          return {
            ...current,
            mappings: {
              ...current.mappings,
              current: nextCount,
            },
          };
        },
        { revalidate: false },
      );
    },
    [mutate],
  );

  const revalidateEntitlements = useCallback(() => {
    return mutate(USAGE_CACHE_KEY);
  }, [mutate]);

  return { adjustMappingCount, revalidateEntitlements };
}

function canAddMore(entitlement: EntitlementLimit | undefined): boolean {
  if (!entitlement) return true;
  if (entitlement.limit === null) return true;
  return entitlement.current < entitlement.limit;
}

export { useEntitlements, useMutateEntitlements, canAddMore, USAGE_CACHE_KEY };
export type { Entitlements, EntitlementLimit, EntitlementTrial };
