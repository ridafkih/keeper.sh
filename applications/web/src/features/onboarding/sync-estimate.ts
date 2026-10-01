import { useEffect, useState } from "react";
import useSWR from "swr";
import { SYNC_RANGE_DEFINITIONS } from "@keeper.sh/data-schemas";
import type { CreateSyncBody, ShareAs, SyncRange } from "@keeper.sh/data-schemas";
import { apiFetch } from "@/lib/fetcher";

export interface SyncEstimate {
  nearTerm: { count: number; days: number };
  total: { count: number; futureRange: SyncRange | null; historicRange: SyncRange | null };
}

const ESTIMATE_DELAY_MS = 400;

const fetchEstimate = async ([url, body]: readonly [string, string]): Promise<SyncEstimate> => {
  const response = await apiFetch(url, { body, headers: { "Content-Type": "application/json" }, method: "POST" });
  return response.json();
};

// Waits for the sentence to settle, so picking calendars one after another asks once.
export function useSyncEstimate(body: CreateSyncBody | null) {
  const serialized = body ? JSON.stringify(body) : null;
  const [settled, setSettled] = useState(serialized);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(serialized), ESTIMATE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [serialized]);

  return useSWR(settled ? (["/api/syncs/estimate", settled] as const) : null, fetchEstimate, { keepPreviousData: true });
}

const rangeLabel = (range: SyncRange): string =>
  (SYNC_RANGE_DEFINITIONS.find(({ value }) => value === range)?.label ?? range).toLowerCase();

export const describeWindow = (estimate: SyncEstimate): string => {
  const { futureRange, historicRange } = estimate.total;
  if (!futureRange || !historicRange) return "across each calendar's sync window";
  return `from ${rangeLabel(historicRange)} back to ${rangeLabel(futureRange)} ahead`;
};

export const describeCopies = (count: number, shareAs: ShareAs): string => {
  const noun = shareAs === "busy_only" ? "busy block" : "event copy";
  if (count === 1) return `1 ${noun}`;
  const plural = shareAs === "busy_only" ? "busy blocks" : "event copies";
  return `${count.toLocaleString()} ${plural}`;
};

export const joinNames = (names: readonly string[]): string => {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
};
