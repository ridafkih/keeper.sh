import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSWRConfig } from "swr";
import { apiFetch, fetcher, HttpError } from "@/lib/fetcher";
import { invalidateAccountsAndSources } from "@/lib/swr";
import { track, ANALYTICS_EVENTS } from "@/lib/analytics";
import { resolveErrorMessage } from "@/utils/errors";
import { useMutateEntitlements, type Entitlements } from "@/hooks/use-entitlements";
import { completeRules, removeRulesFrom, type SetupDraft } from "./setup-draft";
import {
  buildDestinationPuts,
  buildSourcePatches,
  countNewMappings,
  exceedsMappingLimit,
  type ExistingDestinations,
} from "./setup-commit";
import type { DraftUpdater } from "./use-setup-draft";

export type CommitStatus =
  | { kind: "idle" }
  | { kind: "committing" }
  | { kind: "limit" }
  | { kind: "error"; message: string };

const HTTP_PAYMENT_REQUIRED = 402;
const JSON_HEADERS = { "Content-Type": "application/json" };

const loadExistingDestinations = async (sourceIds: string[]): Promise<ExistingDestinations> => {
  const entries = await Promise.all(sourceIds.map(async (sourceId) => {
    const data = await fetcher<{ destinationIds: string[] }>(`/api/sources/${sourceId}/destinations`);
    return [sourceId, data.destinationIds] as const;
  }));
  return Object.fromEntries(entries);
};

interface UseCommitRulesOptions {
  draft: SetupDraft | null;
  entitlements: Entitlements | undefined;
  update: (updater: DraftUpdater) => void;
  clear: () => void;
}

export function useCommitRules({ draft, entitlements, update, clear }: UseCommitRulesOptions) {
  const navigate = useNavigate();
  const { mutate } = useSWRConfig();
  const { adjustMappingCount, revalidateEntitlements } = useMutateEntitlements();
  const [status, setStatus] = useState<CommitStatus>({ kind: "idle" });

  const commit = async () => {
    if (!draft) return;
    const rules = completeRules(draft);
    if (rules.length === 0) return;
    setStatus({ kind: "committing" });

    try {
      const existing = await loadExistingDestinations([...new Set(rules.map((rule) => rule.fromId))]);
      const puts = buildDestinationPuts(rules, existing);
      const added = countNewMappings(puts, existing);
      const current = entitlements?.mappings.current ?? 0;
      if (exceedsMappingLimit(current + added, entitlements?.mappings.limit ?? null)) {
        setStatus({ kind: "limit" });
        return;
      }

      adjustMappingCount(added);
      let applied = 0;
      try {
        for (const put of puts) {
          await apiFetch(`/api/sources/${put.sourceId}/destinations`, {
            body: JSON.stringify({ calendarIds: put.calendarIds }),
            headers: JSON_HEADERS,
            method: "PUT",
          });
          applied += put.calendarIds.length - (existing[put.sourceId]?.length ?? 0);
          void mutate(`/api/sources/${put.sourceId}/destinations`, { destinationIds: put.calendarIds }, { revalidate: false });
          update((current) => removeRulesFrom(current, put.sourceId));
        }
      } catch (error) {
        adjustMappingCount(applied - added);
        throw error;
      }

      track(ANALYTICS_EVENTS.setup_completed, { rules: rules.length });

      for (const patch of buildSourcePatches(rules)) {
        await apiFetch(`/api/sources/${patch.sourceId}`, {
          body: JSON.stringify(patch.body),
          headers: JSON_HEADERS,
          method: "PATCH",
        });
      }

      await invalidateAccountsAndSources(mutate, "/api/entitlements");
      clear();
      navigate({ to: "/dashboard" });
    } catch (error) {
      if (error instanceof HttpError && error.status === HTTP_PAYMENT_REQUIRED) {
        setStatus({ kind: "limit" });
        return;
      }
      setStatus({ kind: "error", message: resolveErrorMessage(error, "Failed to start syncing.") });
    } finally {
      void revalidateEntitlements();
    }
  };

  return { commit, status };
}
