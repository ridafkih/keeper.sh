import { useMemo, useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";
import { fetcher } from "@/lib/fetcher";
import { useSubscription } from "./use-subscription";

interface EntitlementLimit {
  current: number;
  limit: number | null;
}

interface Entitlements {
  plan: "free" | "pro";
  accounts: EntitlementLimit;
  feeds: EntitlementLimit;
  syncs: EntitlementLimit;
  canCustomizeIcalFeed: boolean;
  canUseEventFilters: boolean;
  realtimeSync: boolean;
}

const USAGE_CACHE_KEY = "/api/entitlements";

function buildOptimisticProEntitlements(): Entitlements {
  return {
    plan: "pro",
    accounts: { current: 0, limit: null },
    feeds: { current: 0, limit: null },
    syncs: { current: 0, limit: null },
    canCustomizeIcalFeed: true,
    canUseEventFilters: true,
    realtimeSync: false,
  };
}

function useEntitlements() {
  const { data: subscription } = useSubscription();
  const {
    data: serverEntitlements,
    mutate,
    isLoading,
    error,
  } = useSWR<Entitlements>(USAGE_CACHE_KEY, fetcher);

  const data = useMemo<Entitlements | undefined>(() => {
    if (serverEntitlements) {
      return serverEntitlements;
    }

    if (subscription?.plan !== "pro") {
      return undefined;
    }

    return buildOptimisticProEntitlements();
  }, [serverEntitlements, subscription?.plan]);

  return { data, mutate, isLoading, error };
}

function useMutateEntitlements() {
  const { mutate } = useSWRConfig();

  const revalidateEntitlements = useCallback(() => {
    return mutate(USAGE_CACHE_KEY);
  }, [mutate]);

  return { revalidateEntitlements };
}

function canAddMore(entitlement: EntitlementLimit | undefined): boolean {
  if (!entitlement) return true;
  if (entitlement.limit === null) return true;
  return entitlement.current < entitlement.limit;
}

export {
  buildOptimisticProEntitlements,
  canAddMore,
  useEntitlements,
  useMutateEntitlements,
  USAGE_CACHE_KEY,
};
export type { Entitlements, EntitlementLimit };
