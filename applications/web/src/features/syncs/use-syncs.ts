import { useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";
import useSWRInfinite, { unstable_serialize } from "swr/infinite";
import type { CreateSyncBody, PatchSyncBody, SyncActivityPage, SyncDetail, SyncSummary } from "@keeper.sh/data-schemas";
import { apiFetch, fetcher } from "@/lib/fetcher";
import { serializedPatch } from "@/lib/serialized-mutate";
import { USAGE_CACHE_KEY } from "@/hooks/use-entitlements";
import type { CalendarSource } from "@/types/api";
import { SYNCS_KEY, newestFirst, syncActivityKey, syncKey, type CalendarsById } from "./syncs";

const JSON_HEADERS = { "Content-Type": "application/json" };
const ACTIVITY_PAGE_SIZE = 30;

export const useSyncs = () => useSWR<SyncSummary[]>(SYNCS_KEY, fetcher);

export function useSyncRows() {
  const { data: syncs, error, mutate } = useSyncs();
  const { data: calendars } = useSWR<CalendarSource[]>("/api/sources", fetcher);
  const calendarsById: CalendarsById = new Map((calendars ?? []).map((calendar) => [calendar.id, calendar] as const));
  return { calendarsById, error, mutate, syncs: syncs && newestFirst(syncs) };
}

export const useSync = (syncId: string) => useSWR<SyncDetail>(syncKey(syncId), fetcher);

// Shared with the refresh below, which has to name the infinite key itself: a filter mutate skips it.
export const syncActivityPageKey = (syncId: string) => (index: number, previous: SyncActivityPage | null): string | null => {
  if (index > 0 && !previous?.nextCursor) return null;
  const cursor = previous?.nextCursor ? `&before=${encodeURIComponent(previous.nextCursor)}` : "";
  return `${syncActivityKey(syncId)}?limit=${ACTIVITY_PAGE_SIZE}${cursor}`;
};

export const useSyncActivity = (syncId: string) => {
  const result = useSWRInfinite<SyncActivityPage>(syncActivityPageKey(syncId), fetcher);
  const pages = result.data ?? [];
  return {
    ...result,
    entries: pages.flatMap((page) => page.entries),
    hasMore: Boolean(pages[pages.length - 1]?.nextCursor),
    summary: pages[0]?.summary ?? null,
  };
};

export const createSync = async (body: CreateSyncBody): Promise<SyncDetail> => {
  const response = await apiFetch(SYNCS_KEY, { body: JSON.stringify(body), headers: JSON_HEADERS, method: "POST" });
  return response.json();
};

export const updateSync = async (syncId: string, body: PatchSyncBody): Promise<SyncDetail> => {
  const response = await apiFetch(syncKey(syncId), { body: JSON.stringify(body), headers: JSON_HEADERS, method: "PATCH" });
  return response.json();
};

export const deleteSync = async (syncId: string): Promise<void> => {
  await apiFetch(syncKey(syncId), { method: "DELETE" });
};

export const setCalendarPaused = async (calendarId: string, paused: boolean): Promise<void> => {
  await apiFetch(`/api/sources/${calendarId}`, { body: JSON.stringify({ paused }), headers: JSON_HEADERS, method: "PATCH" });
};

export function useRefreshSyncs() {
  const { mutate } = useSWRConfig();
  return useCallback((syncId?: string) => Promise.all([
    mutate(SYNCS_KEY),
    mutate(USAGE_CACHE_KEY),
    ...(syncId ? [mutate(syncKey(syncId)), mutate(unstable_serialize(syncActivityPageKey(syncId)))] : []),
  ]), [mutate]);
}

interface PatchCallbacks {
  onError: (error: unknown) => void;
  onSaved?: (sync: SyncDetail) => void;
  onSettled?: () => void;
}

// The updatedAt each sync's latest PATCH from this tab came back with.
const ownUpdatedAt = new Map<string, string>();

const flushPatch = async (syncId: string, body: Record<string, unknown>, { onSaved, onSettled }: Omit<PatchCallbacks, "onError">) => {
  try {
    const updated = await updateSync(syncId, body);
    ownUpdatedAt.set(syncId, updated.updatedAt);
    onSaved?.(updated);
    return updated;
  } finally {
    onSettled?.();
  }
};

// Edits are merged into one queued PATCH per sync so quick changes land in order.
export const patchSync = (syncId: string, patch: PatchSyncBody, callbacks: PatchCallbacks): void => {
  serializedPatch(syncKey(syncId), { ...patch }, (merged) => flushPatch(syncId, merged, callbacks), callbacks.onError);
};

/* A save waits behind any immediate change still going out. Its expectedUpdatedAt is the copy the user started from,
 * unless it had to wait: then that change from this tab moved updatedAt on, and its response says where to. */
export const saveSync = (syncId: string, body: PatchSyncBody): Promise<SyncDetail> => new Promise((resolve, reject) => {
  let waited = false;
  serializedPatch(
    syncKey(syncId),
    { ...body },
    (merged) => {
      const expectedUpdatedAt = waited ? ownUpdatedAt.get(syncId) ?? merged.expectedUpdatedAt : merged.expectedUpdatedAt;
      return flushPatch(syncId, { ...merged, expectedUpdatedAt }, { onSaved: resolve });
    },
    reject,
  );
  waited = true;
});
