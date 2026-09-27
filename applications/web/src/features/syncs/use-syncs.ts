import { useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";
import useSWRInfinite from "swr/infinite";
import type { CreateSyncBody, PatchSyncBody, SyncActivityEntry, SyncDetail, SyncSummary } from "@keeper.sh/data-schemas";
import { apiFetch, fetcher } from "@/lib/fetcher";
import { serializedPatch } from "@/lib/serialized-mutate";
import { USAGE_CACHE_KEY } from "@/hooks/use-entitlements";
import { SYNCS_KEY, syncActivityKey, syncKey } from "./syncs";

const JSON_HEADERS = { "Content-Type": "application/json" };
const ACTIVITY_PAGE_SIZE = 30;

interface SyncActivityPage {
  entries: SyncActivityEntry[];
  nextCursor: string | null;
}

export const useSyncs = () => useSWR<SyncSummary[]>(SYNCS_KEY, fetcher);

export const useSync = (syncId: string) => useSWR<SyncDetail>(syncKey(syncId), fetcher);

export const useSyncActivity = (syncId: string) => {
  const result = useSWRInfinite<SyncActivityPage>(
    (index, previous: SyncActivityPage | null) => {
      if (index > 0 && !previous?.nextCursor) return null;
      const cursor = previous?.nextCursor ? `&before=${encodeURIComponent(previous.nextCursor)}` : "";
      return `${syncActivityKey(syncId)}?limit=${ACTIVITY_PAGE_SIZE}${cursor}`;
    },
    fetcher,
  );
  const pages = result.data ?? [];
  return {
    ...result,
    entries: pages.flatMap((page) => page.entries),
    hasMore: Boolean(pages[pages.length - 1]?.nextCursor),
  };
};

export const createSync = async (body: CreateSyncBody): Promise<SyncDetail> => {
  const response = await apiFetch(SYNCS_KEY, { body: JSON.stringify(body), headers: JSON_HEADERS, method: "POST" });
  return response.json();
};

export const deleteSync = async (syncId: string): Promise<void> => {
  await apiFetch(syncKey(syncId), { method: "DELETE" });
};

export function useRefreshSyncs() {
  const { mutate } = useSWRConfig();
  return useCallback((syncId?: string) => Promise.all([
    mutate(SYNCS_KEY),
    mutate(USAGE_CACHE_KEY),
    ...(syncId ? [mutate(syncKey(syncId)), mutate((key) => typeof key === "string" && key.startsWith(syncActivityKey(syncId)))] : []),
  ]), [mutate]);
}

// Edits are merged into one queued PATCH per sync so quick changes land in order.
export const patchSync = (
  syncId: string,
  patch: PatchSyncBody,
  onError: (error: unknown) => void,
  onSettled: () => void,
): void => {
  const key = syncKey(syncId);
  serializedPatch(
    key,
    { ...patch },
    (merged) => apiFetch(key, { body: JSON.stringify(merged), headers: JSON_HEADERS, method: "PATCH" }).finally(onSettled),
    onError,
  );
};
