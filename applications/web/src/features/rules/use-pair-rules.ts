import { useCallback } from "react";
import useSWR from "swr";
import { apiFetch, fetcher } from "@/lib/fetcher";
import { serializedCall } from "@/lib/serialized-mutate";
import { pairRulesPath } from "./rules";

export interface PairRules {
  ruleIds: string[];
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export const putPairRules = async (sourceId: string, destinationId: string, ruleIds: string[]): Promise<void> => {
  await apiFetch(pairRulesPath(sourceId, destinationId), {
    body: JSON.stringify({ ruleIds }),
    headers: JSON_HEADERS,
    method: "PUT",
  });
};

export const readPairRules = (sourceId: string, destinationId: string): Promise<PairRules> =>
  fetcher<PairRules>(pairRulesPath(sourceId, destinationId));

// Appends without disturbing the pair's existing order; a rule already on the pair is left where it is.
export const assignRuleToPair = async (sourceId: string, destinationId: string, ruleId: string): Promise<void> => {
  const { ruleIds } = await readPairRules(sourceId, destinationId);
  if (ruleIds.includes(ruleId)) return;
  await putPairRules(sourceId, destinationId, [...ruleIds, ruleId]);
};

export const unassignRuleFromPair = async (sourceId: string, destinationId: string, ruleId: string): Promise<void> => {
  const { ruleIds } = await readPairRules(sourceId, destinationId);
  if (!ruleIds.includes(ruleId)) return;
  await putPairRules(sourceId, destinationId, ruleIds.filter((id) => id !== ruleId));
};

export function usePairRules(sourceId: string, destinationId: string) {
  const key = pairRulesPath(sourceId, destinationId);
  const { data, error, isLoading, mutate } = useSWR<PairRules>(key, fetcher);

  const setRuleIds = useCallback((ruleIds: string[], onError: (error: unknown) => void) => {
    serializedCall(key, () =>
      mutate(
        async () => {
          await putPairRules(sourceId, destinationId, ruleIds);
          return { ruleIds };
        },
        { optimisticData: { ruleIds }, revalidate: false, rollbackOnError: true },
      ).catch((mutationError: unknown) => {
        onError(mutationError);
        void mutate();
      }));
  }, [key, mutate, sourceId, destinationId]);

  return { data, error, isLoading, mutate, setRuleIds };
}
