import useSWR from "swr";
import type { SyncRule } from "@keeper.sh/data-schemas";
import { apiFetch, fetcher } from "@/lib/fetcher";
import { serializedPatch } from "@/lib/serialized-mutate";
import type { SyncRuleDetail, SyncRuleListItem } from "./rules";

export const RULES_KEY = "/api/rules";

export const ruleKey = (ruleId: string): string => `/api/rules/${ruleId}`;

const JSON_HEADERS = { "Content-Type": "application/json" };

export const useRules = (fallbackData?: SyncRuleListItem[]) =>
  useSWR<SyncRuleListItem[]>(RULES_KEY, fetcher, { fallbackData });

export const useRule = (ruleId: string) => useSWR<SyncRuleDetail>(ruleKey(ruleId), fetcher);

export const createRule = async (name: string): Promise<SyncRule> => {
  const response = await apiFetch(RULES_KEY, { body: JSON.stringify({ name }), headers: JSON_HEADERS, method: "POST" });
  return response.json();
};

export const deleteRule = async (ruleId: string): Promise<void> => {
  await apiFetch(ruleKey(ruleId), { method: "DELETE" });
};

export type RulePatch = Partial<Pick<SyncRule, "actions" | "conditions" | "name">>;

// Patches to one rule are queued so quick edits land in order, then the list is refreshed for its summary.
export const patchRule = (
  ruleId: string,
  patch: RulePatch,
  onError: (error: unknown) => void,
  onSettled: () => void,
): void => {
  const key = ruleKey(ruleId);
  serializedPatch(
    key,
    patch,
    (merged) => apiFetch(key, { body: JSON.stringify(merged), headers: JSON_HEADERS, method: "PATCH" }).finally(onSettled),
    onError,
  );
};
