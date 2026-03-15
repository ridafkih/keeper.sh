import { atom } from "jotai";
import { selectAtom } from "jotai/utils";
import type { SyncAggregate } from "@keeper.sh/data-schemas/client";

export type CompositeState = "idle" | "syncing";

export type SyncAggregateData = SyncAggregate;

export interface CompositeSyncState {
  state: CompositeState;
  seq: number;
  progressPercent: number;
  syncEventsProcessed: number;
  syncEventsRemaining: number;
  syncEventsTotal: number;
  lastSyncedAt: string | null;
  connected: boolean;
  hasReceivedAggregate: boolean;
}

export const syncStateAtom = atom<CompositeSyncState>({
  state: "idle",
  seq: 0,
  progressPercent: 100,
  syncEventsProcessed: 0,
  syncEventsRemaining: 0,
  syncEventsTotal: 0,
  lastSyncedAt: null,
  connected: false,
  hasReceivedAggregate: false,
});

export const syncStatusLabelAtom = selectAtom(syncStateAtom, (composite) => {
  if (!composite.connected) {
    return "Connecting";
  }

  if (!composite.hasReceivedAggregate) {
    return "Connecting";
  }

  if (composite.state === "syncing") {
    return "Syncing";
  }

  if (composite.syncEventsRemaining === 0) {
    return "Up to Date";
  }

  return "Sync Paused";
});

export const syncStatusShimmerAtom = selectAtom(
  syncStateAtom,
  (composite) =>
    !composite.connected || !composite.hasReceivedAggregate || composite.state === "syncing",
);
