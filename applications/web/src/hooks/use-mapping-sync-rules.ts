import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { useMutateEntitlements } from "@/hooks/use-entitlements";
import { apiFetch } from "@/lib/fetcher";
import { serializedPatch } from "@/lib/serialized-mutate";
import type { MappingSyncRules } from "@/types/api";
import { resolveErrorMessage } from "@/utils/errors";
import { applyOverridePatch } from "@/utils/mapping-sync-rules";
import type { RuleOverridePatch } from "@/utils/mapping-sync-rules";

const SAVE_ERROR_FALLBACK = "Failed to save this setting.";

export const getSourceDestinationsKey = (calendarId: string): string =>
  `/api/sources/${calendarId}/destinations`;

export const getDestinationSourcesKey = (destinationId: string): string =>
  `/api/sources/${destinationId}/sources`;

const getMappingSyncRulesKey = (calendarId: string, destinationId: string): string =>
  `${getSourceDestinationsKey(calendarId)}/${destinationId}`;

export type PatchRuleOverrides = (patch: RuleOverridePatch) => void;
export type SetIncludeUpstreamSources = (enabled: boolean) => void;

export function useMappingSyncRules(calendarId: string, destinationId: string) {
  const key = getMappingSyncRulesKey(calendarId, destinationId);
  const { data, error, isLoading, mutate } = useSWR<MappingSyncRules>(key);
  const { mutate: globalMutate } = useSWRConfig();
  const { revalidateEntitlements } = useMutateEntitlements();
  const [saveError, setSaveError] = useState<string | null>(null);

  const patchOverrides: PatchRuleOverrides = (patch) => {
    setSaveError(null);
    void mutate(
      (current) => (current ? applyOverridePatch(current, patch) : current),
      { revalidate: false },
    );
    serializedPatch(
      key,
      patch,
      async (mergedPatch) => {
        await apiFetch(key, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(mergedPatch),
        });
        void globalMutate(getSourceDestinationsKey(calendarId));
      },
      (patchError) => {
        setSaveError(resolveErrorMessage(patchError, SAVE_ERROR_FALLBACK));
        void mutate();
      },
    );
  };

  const setIncludeUpstreamSources: SetIncludeUpstreamSources = (enabled) => {
    setSaveError(null);
    void mutate(
      (current) => (current ? { ...current, includeUpstreamSources: enabled } : current),
      { revalidate: false },
    );
    serializedPatch(
      key,
      { includeUpstreamSources: enabled },
      async (mergedPatch) => {
        await apiFetch(key, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(mergedPatch),
        });
        void globalMutate(getDestinationSourcesKey(destinationId));
        void revalidateEntitlements();
      },
      (patchError) => {
        setSaveError(resolveErrorMessage(patchError, SAVE_ERROR_FALLBACK));
        void mutate();
      },
    );
  };

  return {
    error,
    isLoading,
    mapping: data,
    patchOverrides,
    setIncludeUpstreamSources,
    retry: () => mutate(),
    saveError,
  };
}
